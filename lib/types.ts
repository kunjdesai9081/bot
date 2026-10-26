export type Channel = 'whatsapp' | 'instagram';
export type Sender = 'customer' | 'bot' | 'operator';
export type HitlStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMED_OUT' | 'EXECUTED';

export interface Conversation {
  id: string;
  channel: Channel;
  channel_user_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PendingAction {
  id: string;
  conversation_id: string;
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  customer_summary: string;
  status: HitlStatus;
  operator_id?: string;
  operator_comment?: string;
  telegram_message_id?: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeMatch {
  id: number;
  question: string;
  answer: string;
  similarity: number;
}

export interface InboundMessageEvent {
  channel: Channel;
  userId: string;
  messageId: string;
  text: string;
  timestamp: string;
  rawPayload: Record<string, unknown>;
}
