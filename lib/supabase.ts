import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Conversation, Channel, PendingAction, KnowledgeMatch, HitlStatus } from './types.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.warn('[Supabase] Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in environment variables.');
    return null;
  }

  supabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  });
  return supabaseClient;
}

/**
 * Get or create a customer conversation record
 */
export async function getOrCreateConversation(channel: Channel, channelUserId: string): Promise<Conversation | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: existing, error: fetchErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[Supabase] Error fetching conversation:', fetchErr);
  }

  if (existing) return existing as Conversation;

  const { data: created, error: insertErr } = await supabase
    .from('conversations')
    .insert({ channel, channel_user_id: channelUserId })
    .select('*')
    .single();

  if (insertErr) {
    console.error('[Supabase] Error creating conversation:', insertErr);
    return null;
  }

  return created as Conversation;
}

/**
 * Record a message in the chat log
 */
export async function recordMessage(
  conversationId: string,
  sender: 'customer' | 'bot' | 'operator',
  content: string,
  rawPayload?: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase.from('chat_messages').insert({
    conversation_id: conversationId,
    sender,
    content,
    raw_payload: rawPayload || {},
  });

  if (error) {
    console.error('[Supabase] Error saving message log:', error);
  }
}

/**
 * Query Knowledge Base via cosine similarity RPC
 */
export async function searchKnowledgeBase(
  queryEmbedding: number[],
  matchThreshold = 0.65,
  matchCount = 3
): Promise<KnowledgeMatch[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('match_knowledge_base', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error('[Supabase] Vector search RPC error:', error);
    return [];
  }

  return (data || []) as KnowledgeMatch[];
}

/**
 * Create a new pending action requiring Human-in-the-Loop confirmation
 */
export async function createPendingAction(params: {
  conversationId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  customerSummary: string;
  expiresInMinutes?: number;
}): Promise<PendingAction | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const expiresIn = params.expiresInMinutes || 5;
  const expiresAt = new Date(Date.now() + expiresIn * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('pending_actions')
    .insert({
      conversation_id: params.conversationId,
      tool_name: params.toolName,
      tool_arguments: params.toolArguments,
      customer_summary: params.customerSummary,
      status: 'PENDING',
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[Supabase] Error creating pending action:', error);
    return null;
  }

  return data as PendingAction;
}

/**
 * Attach the Telegram message ID to the pending action for future inline button edits
 */
export async function linkTelegramMessageToAction(actionId: string, telegramMessageId: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase
    .from('pending_actions')
    .update({ telegram_message_id: telegramMessageId })
    .eq('id', actionId);
}

/**
 * Atomic state transition for action confirmation/rejection
 */
export async function resolvePendingAction(
  actionId: string,
  newStatus: HitlStatus,
  operatorId: string,
  comment?: string
): Promise<PendingAction | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  // Atomic test-and-set: only update if currently 'PENDING'
  const { data, error } = await supabase
    .from('pending_actions')
    .update({
      status: newStatus,
      operator_id: operatorId,
      operator_comment: comment || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('status', 'PENDING')
    .select('*, conversations(*)')
    .maybeSingle();

  if (error) {
    console.error('[Supabase] Error resolving pending action:', error);
    return null;
  }

  return data as PendingAction | null;
}

/**
 * Get action by ID
 */
export async function getActionById(actionId: string): Promise<any | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('pending_actions')
    .select('*, conversations(*)')
    .eq('id', actionId)
    .maybeSingle();

  if (error) {
    console.error('[Supabase] Error getting action by ID:', error);
    return null;
  }

  return data;
}
