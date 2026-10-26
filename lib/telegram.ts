const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface TelegramAlertParams {
  actionId: string;
  customerChannel: string;
  customerUserId: string;
  customerSummary: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  expiresInMinutes?: number;
}

/**
 * Send an interactive Human-in-the-Loop alert card with inline Approve / Reject buttons
 */
export async function sendOperatorAlertCard(params: TelegramAlertParams): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPERATOR_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] Skipping alert: TELEGRAM_BOT_TOKEN or OPERATOR_TELEGRAM_CHAT_ID not configured.');
    return null;
  }

  const prettyArgs = JSON.stringify(params.toolArguments, null, 2);
  const text = 
    `🚨 *CONFIRMATION REQUIRED: Sensitive Customer Action*\n\n` +
    `👤 *Channel:* \`${params.customerChannel.toUpperCase()}\` (\`${params.customerUserId}\`)\n` +
    `💬 *Customer Request:* "${params.customerSummary}"\n` +
    `🛠️ *Requested Action:* \`${params.toolName}\`\n` +
    `📦 *Parameters:*\n\`\`\`json\n${prettyArgs}\n\`\`\`\n` +
    `⏳ *Action Expires In:* ${params.expiresInMinutes || 5} minutes\n\n` +
    `_Please click below to authorize or reject this operation:_`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve & Execute', callback_data: `hitl:approve:${params.actionId}` },
        { text: '❌ Reject Request', callback_data: `hitl:reject:${params.actionId}` }
      ],
      [
        { text: '💬 Manual Chat Takeover', callback_data: `hitl:takeover:${params.actionId}` }
      ]
    ]
  };

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard,
      }),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.ok) {
      console.error('[Telegram] Failed to send alert message:', data);
      return null;
    }

    return data.result?.message_id || null;
  } catch (err) {
    console.error('[Telegram] Network error sending operator alert:', err);
    return null;
  }
}

/**
 * Edit an existing Telegram message to reflect approval, rejection, or takeover
 */
export async function updateTelegramMessageStatus(
  messageId: number,
  status: 'APPROVED' | 'REJECTED' | 'TIMED_OUT' | 'TAKEOVER',
  operatorName: string
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPERATOR_TELEGRAM_CHAT_ID;

  if (!token || !chatId || !messageId) return;

  const statusIcons: Record<string, string> = {
    APPROVED: '✅ *APPROVED & EXECUTED*',
    REJECTED: '❌ *REJECTED BY OPERATOR*',
    TIMED_OUT: '⏰ *TIMED OUT (EXPIRED)*',
    TAKEOVER: '👤 *MANUAL TAKEOVER INITIATED*',
  };

  const statusBanner = statusIcons[status] || status;

  try {
    // 1. Edit the keyboard to remove interactive buttons
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: `${statusBanner} (by ${operatorName})`, callback_data: 'noop' }]
          ]
        },
      }),
    });
  } catch (err) {
    console.error('[Telegram] Error updating message markup:', err);
  }
}

/**
 * Send general text notifications to the operator
 */
export async function sendOperatorNotification(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPERATOR_TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('[Telegram] Error sending notification:', err);
  }
}
