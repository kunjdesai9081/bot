import { GoogleGenAI, Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { searchKnowledgeBase } from './supabase.js';

let aiClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (aiClient) return aiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] Warning: GEMINI_API_KEY is not set in environment.');
    return null;
  }
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

/**
 * Generate 768-dimension text embedding for semantic search
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const ai = getGenAI();
  if (!ai) return null;

  try {
    const res = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });
    return res.embeddings?.[0]?.values || null;
  } catch (err) {
    console.error('[Gemini] Failed to generate embedding:', err);
    return null;
  }
}

/**
 * Sensitive tools that trigger Human-in-the-Loop Confirmation
 */
const SENSITIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'request_order_cancellation',
    description: 'Trigger an order cancellation workflow for an existing customer order. Requires human confirmation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: { type: Type.STRING, description: 'Order ID or tracking number provided by the customer.' },
        reason: { type: Type.STRING, description: 'Customer reason for requesting the cancellation.' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'request_refund',
    description: 'Trigger a monetary refund request for an item or transaction. Requires human confirmation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        order_id: { type: Type.STRING, description: 'Order ID associated with the refund.' },
        amount: { type: Type.STRING, description: 'Requested refund amount if specified.' },
        reason: { type: Type.STRING, description: 'Explanation or justification for refund.' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'request_custom_discount',
    description: 'Trigger a request for a custom price match, coupon, or bulk discount. Requires human confirmation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        item_name: { type: Type.STRING, description: 'Name or category of product.' },
        discount_percentage: { type: Type.STRING, description: 'Requested discount percentage or target price.' },
      },
      required: ['item_name'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Escalate the conversation to a human support agent when customer explicitly demands a person.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING, description: 'Why human escalation is required.' },
      },
      required: ['reason'],
    },
  },
];

export interface AgentResult {
  replyText: string;
  requiresConfirmation: boolean;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Run the Google Agent Development Kit reasoning loop on an incoming message
 */
export async function runAgent(params: {
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}): Promise<AgentResult> {
  const ai = getGenAI();
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  if (!ai) {
    return {
      replyText: 'Thank you for reaching out! Our AI agent is currently being configured with its API key.',
      requiresConfirmation: false,
    };
  }

  // 1. Vector Search for relevant Knowledge Base FAQs
  let contextSnippet = 'No specific knowledge base articles found.';
  const embedding = await getEmbedding(params.userMessage);
  if (embedding) {
    const matches = await searchKnowledgeBase(embedding, 0.65, 3);
    if (matches.length > 0) {
      contextSnippet = matches
        .map((m, i) => `[Fact ${i + 1}] Q: ${m.question}\nA: ${m.answer}`)
        .join('\n\n');
    }
  }

  // 2. Build Guardrailed System Prompt
  const systemInstruction = `
You are the official Customer Support AI Agent for our business.
You are running via the Google Agent Development Kit on Meta WhatsApp and Instagram DMs.

### GROUNDED FACTS FROM KNOWLEDGE BASE:
${contextSnippet}

### OPERATING RULES & GUARDRAILS:
1. Answer customer questions strictly and politely based on the provided facts above.
2. If the user asks about hours, shipping times, return policies, or FAQs, answer directly and concisely.
3. NEVER promise unauthorized refunds, cancellations, or custom discounts on your own.
4. If the user wants to cancel an order, request a refund, request a discount, or speak with a live person, YOU MUST CALL the appropriate tool (request_order_cancellation, request_refund, request_custom_discount, escalate_to_human).
5. If the facts do not contain the answer and no tool applies, say: "I'll double check that with our specialist team and have someone get back to you shortly."
`.trim();

  try {
    const contents: any[] = [];
    if (params.conversationHistory && params.conversationHistory.length > 0) {
      for (const turn of params.conversationHistory) {
        contents.push({
          role: turn.role,
          parts: [{ text: turn.text }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: params.userMessage }],
    });

    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 500,
        tools: [
          {
            functionDeclarations: SENSITIVE_TOOLS,
          },
        ],
      },
    });

    // 3. Inspect if tool calling was triggered
    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const toolCall = functionCalls[0];
      const toolName = toolCall.name || 'unknown_tool';
      const toolArgs = (toolCall.args || {}) as Record<string, unknown>;

      let placeholderReply = "I've flagged your request for our team specialist. They are reviewing it and will confirm shortly!";
      if (toolName === 'request_order_cancellation') {
        placeholderReply = `I've submitted an authorization request to cancel order #${toolArgs.order_id || 'provided'}. A team manager will confirm shortly.`;
      } else if (toolName === 'request_refund') {
        placeholderReply = `I have logged your refund request for order #${toolArgs.order_id || 'provided'} and submitted it for human manager approval.`;
      } else if (toolName === 'request_custom_discount') {
        placeholderReply = `I've sent your discount inquiry for "${toolArgs.item_name || 'your item'}" to our team for approval.`;
      } else if (toolName === 'escalate_to_human') {
        placeholderReply = `I am connecting you with a human specialist now. Someone will reply to this chat shortly.`;
      }

      return {
        replyText: placeholderReply,
        requiresConfirmation: true,
        toolCall: {
          name: toolName,
          arguments: toolArgs,
        },
      };
    }

    // 4. Return standard grounded response
    const replyText = response.text || "Thank you for messaging us. How else may I assist you today?";
    return {
      replyText,
      requiresConfirmation: false,
    };
  } catch (err) {
    console.error('[Gemini] Generation error:', err);
    return {
      replyText: "Thank you for reaching out! We received your message and our team will get back to you shortly.",
      requiresConfirmation: false,
    };
  }
}
