import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolvePendingAction, getActionById, recordMessage } from '../lib/supabase.js';
import { updateTelegramMessageStatus } from '../lib/telegram.js';
import { sendChannelMessage } from '../lib/meta.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Ready');
  }

  const update = req.body || {};
  const callbackQuery = update.callback_query;

  // If this update is not a button click, acknowledge and return
  if (!callbackQuery) {
    return res.status(200).json({ ok: true });
  }

  const callbackData = callbackQuery.data as string; // e.g. "hitl:approve:a83fcf39"
  const operatorUser = callbackQuery.from?.first_name || 'Operator';
  const operatorId = String(callbackQuery.from?.id || 'unknown');
  const messageId = callbackQuery.message?.message_id;

  // Acknowledge Telegram callback immediately to stop the button loading spinner
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && callbackQuery.id) {
    fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    }).catch((err) => console.error('[Telegram] Error answering callback query:', err));
  }

  if (!callbackData || !callbackData.startsWith('hitl:')) {
    return res.status(200).json({ ok: true });
  }

  const [, decision, actionId] = callbackData.split(':');
  if (!actionId || !decision) {
    return res.status(200).json({ ok: true });
  }

  console.log(`[Telegram HITL] Operator ${operatorUser} (${operatorId}) selected: ${decision} for action ${actionId}`);

  try {
    // 1. Fetch current action details
    const existing = await getActionById(actionId);
    if (!existing) {
      console.warn(`[Telegram HITL] Action ${actionId} not found.`);
      return res.status(200).json({ ok: true });
    }

    if (existing.status !== 'PENDING') {
      console.log(`[Telegram HITL] Action ${actionId} already resolved: ${existing.status}`);
      return res.status(200).json({ ok: true });
    }

    const conversation = existing.conversations;
    const channel = conversation?.channel || 'whatsapp';
    const channelUserId = conversation?.channel_user_id;

    // 2. Handle Decision Logic
    if (decision === 'approve') {
      const resolved = await resolvePendingAction(actionId, 'APPROVED', operatorUser);
      if (!resolved) {
        console.warn(`[Telegram HITL] Action ${actionId} state transition race condition.`);
        return res.status(200).json({ ok: true });
      }

      // Update Telegram Card UI
      if (messageId) {
        await updateTelegramMessageStatus(messageId, 'APPROVED', operatorUser);
      }

      // Execute tool & notify customer
      let customerNotification = `Great news! Your request has been reviewed and authorized by our team specialist.`;
      if (existing.tool_name === 'request_order_cancellation') {
        const orderId = existing.tool_arguments?.order_id || '';
        customerNotification = `Your cancellation request for order #${orderId} has been approved and processed successfully.`;
      } else if (existing.tool_name === 'request_refund') {
        const orderId = existing.tool_arguments?.order_id || '';
        customerNotification = `Your refund request for order #${orderId} has been authorized. You should see the credit reflected in 3-5 business days.`;
      } else if (existing.tool_name === 'request_custom_discount') {
        customerNotification = `Our manager approved your special pricing inquiry! We have applied the requested discount to your account.`;
      }

      if (channelUserId) {
        await sendChannelMessage(channel, channelUserId, customerNotification);
        await recordMessage(conversation.id, 'operator', customerNotification);
      }
    } else if (decision === 'reject') {
      const resolved = await resolvePendingAction(actionId, 'REJECTED', operatorUser);
      if (!resolved) return res.status(200).json({ ok: true });

      // Update Telegram Card UI
      if (messageId) {
        await updateTelegramMessageStatus(messageId, 'REJECTED', operatorUser);
      }

      // Send courteous refusal to customer
      const rejectionMessage = `Thank you for your patience. Our specialist team reviewed your request and unfortunately we cannot approve this operation at this time. Please let us know if we can assist with anything else!`;

      if (channelUserId) {
        await sendChannelMessage(channel, channelUserId, rejectionMessage);
        await recordMessage(conversation.id, 'operator', rejectionMessage);
      }
    } else if (decision === 'takeover') {
      await resolvePendingAction(actionId, 'TAKEOVER' as any, operatorUser);
      if (messageId) {
        await updateTelegramMessageStatus(messageId, 'TAKEOVER', operatorUser);
      }
      console.log(`[Telegram HITL] Conversation ${conversation?.id} transferred to manual operator.`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Telegram HITL] Error handling callback:', err);
    return res.status(200).json({ ok: true });
  }
}
