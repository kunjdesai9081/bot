import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMetaSignature, sendChannelMessage } from '../lib/meta.js';
import { runAgent } from '../lib/gemini.js';
import {
  getOrCreateConversation,
  recordMessage,
  createPendingAction,
  linkTelegramMessageToAction,
} from '../lib/supabase.js';
import { sendOperatorAlertCard } from '../lib/telegram.js';
import { Channel } from '../lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Meta Webhook Handshake Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.META_VERIFY_TOKEN || 'secure_secret_token_123';

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('[Webhook] Meta verification handshake succeeded.');
      return res.status(200).send(challenge);
    }
    console.warn('[Webhook] Meta verification failed: token mismatch.');
    return res.status(403).send('Forbidden');
  }

  // 2. Inbound Message Processing (POST)
  if (req.method === 'POST') {
    // Optional HMAC signature check
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(rawBody, signature)) {
      console.error('[Webhook] Invalid HMAC signature rejected.');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const payload = req.body || {};

    // Determine channel (WhatsApp vs Instagram)
    let channel: Channel = 'whatsapp';
    let senderId: string | null = null;
    let messageText: string | null = null;
    let messageId: string | null = null;

    if (payload.object === 'whatsapp_business_account') {
      channel = 'whatsapp';
      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      if (message && message.type === 'text') {
        senderId = message.from;
        messageText = message.text?.body;
        messageId = message.id;
      }
    } else if (payload.object === 'instagram') {
      channel = 'instagram';
      const messaging = payload.entry?.[0]?.messaging?.[0];
      if (messaging?.message?.text) {
        senderId = messaging.sender?.id;
        messageText = messaging.message.text;
        messageId = messaging.message.mid;
      }
    }

    // If not a text message or a delivery notification, respond OK immediately
    if (!senderId || !messageText) {
      return res.status(200).json({ status: 'ignored_or_status_update' });
    }

    console.log(`[Webhook] Inbound ${channel} message from ${senderId}: "${messageText}"`);

    try {
      // 3. Conversation & Audit Log Persistence
      const conversation = await getOrCreateConversation(channel, senderId);
      if (conversation) {
        await recordMessage(conversation.id, 'customer', messageText, payload);
      }

      // 4. Run Google Agent Development Kit Reasoning Loop
      const agentResult = await runAgent({ userMessage: messageText });

      // 5. Check if action requires Operator Confirmation (HITL)
      if (agentResult.requiresConfirmation && agentResult.toolCall && conversation) {
        console.log(`[Webhook] Action "${agentResult.toolCall.name}" requires operator confirmation.`);

        // Store pending action in database
        const pendingAction = await createPendingAction({
          conversationId: conversation.id,
          toolName: agentResult.toolCall.name,
          toolArguments: agentResult.toolCall.arguments,
          customerSummary: messageText,
          expiresInMinutes: 5,
        });

        // Dispatch interactive Telegram alert card to operator
        if (pendingAction) {
          const tgMsgId = await sendOperatorAlertCard({
            actionId: pendingAction.id,
            customerChannel: channel,
            customerUserId: senderId,
            customerSummary: messageText,
            toolName: agentResult.toolCall.name,
            toolArguments: agentResult.toolCall.arguments,
            expiresInMinutes: 5,
          });

          if (tgMsgId) {
            await linkTelegramMessageToAction(pendingAction.id, tgMsgId);
          }
        }

        // Send placeholder acknowledgment back to customer
        await sendChannelMessage(channel, senderId, agentResult.replyText);
        await recordMessage(conversation.id, 'bot', agentResult.replyText);

        return res.status(200).json({ status: 'action_pending_confirmation' });
      }

      // 6. Direct Autonomous Answer
      await sendChannelMessage(channel, senderId, agentResult.replyText);
      if (conversation) {
        await recordMessage(conversation.id, 'bot', agentResult.replyText);
      }

      return res.status(200).json({ status: 'resolved_autonomous' });
    } catch (err) {
      console.error('[Webhook] Processing error:', err);
      // Always return 200 to prevent Meta from disabling the webhook on transient errors
      return res.status(200).json({ status: 'error_handled' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
