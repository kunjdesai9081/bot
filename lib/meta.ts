import crypto from 'crypto';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Verify HMAC SHA-256 signature sent by Meta Cloud API
 */
export function verifyMetaSignature(rawBody: string, signatureHeader?: string | string[]): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    // If not configured in development, bypass with a warning
    console.warn('[Meta] Warning: META_APP_SECRET not set; signature verification skipped.');
    return true;
  }

  if (!signatureHeader) return false;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const parts = signature.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;

  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const actualHash = parts[1];
  try {
    return crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(actualHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Send an outbound message to a WhatsApp customer
 */
export async function sendWhatsAppMessage(toPhoneNumber: string, text: string): Promise<boolean> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneId) {
    console.warn('[Meta] Skipping WhatsApp send: META_ACCESS_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID missing.');
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhoneNumber,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Meta] WhatsApp API error:', data);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Meta] Failed to send WhatsApp message:', err);
    return false;
  }
}

/**
 * Send an outbound message to an Instagram DM customer
 */
export async function sendInstagramMessage(recipientId: string, text: string): Promise<boolean> {
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!accessToken) {
    console.warn('[Meta] Skipping Instagram send: META_ACCESS_TOKEN missing.');
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[Meta] Instagram API error:', data);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Meta] Failed to send Instagram message:', err);
    return false;
  }
}

/**
 * Dispatch message to the correct channel
 */
export async function sendChannelMessage(channel: 'whatsapp' | 'instagram', recipientId: string, text: string): Promise<boolean> {
  if (channel === 'whatsapp') {
    return sendWhatsAppMessage(recipientId, text);
  } else {
    return sendInstagramMessage(recipientId, text);
  }
}
