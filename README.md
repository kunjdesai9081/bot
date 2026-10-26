# Autonomous Social AI Agent (Google ADK + HITL on Vercel)

A 100% perpetual free-tier customer interaction AI agent built for **WhatsApp Cloud API** and **Instagram DMs**. Powered by the **Google Agent Development Kit (Gemini Flash)**, **Supabase pgvector**, **Telegram Operator Alerting**, and **Vercel Serverless**.

---

## 🌟 Key Capabilities

- **Zero-Cost Compute:** Deployed on Vercel Hobby serverless functions ($0/month).
- **Google Agent Development Kit:** Utilizes Google GenAI SDK (`@google/genai`) with Gemini 2.0 / 1.5 Flash for multimodal reasoning and tool calling.
- **RAG Knowledge Base:** Fast semantic matching against company policies & FAQs using Supabase `pgvector` with Google's `text-embedding-004`.
- **Proactive Operator Alerting:** Real-time push notifications delivered to your Telegram app.
- **Human-in-the-Loop (HITL) Gate:** Sensitive operations (e.g., cancellations, refunds, discounts) pause the agent, hold the customer with a polite placeholder, and send inline clickable `[Approve]` / `[Reject]` buttons to the operator.
- **Atomic Concurrency:** Prevents double-approvals using atomic test-and-set database transactions.

---

## 📁 Repository Structure

```
c:\Projects\bot\
├── api/
│   ├── webhook.ts            # Meta WhatsApp & Instagram webhook (GET verify, POST receive)
│   └── telegram.ts           # Telegram Bot webhook handling operator approval clicks
├── lib/
│   ├── gemini.ts             # Google Agent Development Kit engine & tool calling
│   ├── meta.ts               # Meta Cloud API signature verification & message dispatch
│   ├── supabase.ts           # Database client, pgvector search & atomic state machine
│   ├── telegram.ts           # Telegram interactive alert cards & button update service
│   └── types.ts              # TypeScript interfaces & types
├── schema.sql                # Complete Supabase PostgreSQL + pgvector DDL setup
├── package.json              # Project dependencies & scripts
├── tsconfig.json             # TypeScript configuration
├── vercel.json               # Vercel serverless functions configuration
├── .env.example              # Environment variables template
└── README.md                 # Complete documentation
```

---

## 🚀 Quick Setup & Deployment

### Step 1: Clone / Navigate to Directory
```bash
cd c:\Projects\bot
npm install
```

### Step 2: Set Up Free Cloud Accounts & Keys

1. **Google AI Studio (Gemini Engine):**
   - Sign in at [aistudio.google.com](https://aistudio.google.com/)
   - Click **Get API key** $\to$ Copy into `GEMINI_API_KEY`.
2. **Supabase (Vector Database):**
   - Create a free project at [supabase.com](https://supabase.com/).
   - Go to the **SQL Editor** and execute [schema.sql](file:///c:/Projects/bot/schema.sql).
   - In **Project Settings** $\to$ **API**, copy `Project URL` and `service_role secret`.
3. **Telegram Bot (Operator Alerting):**
   - Message `@BotFather` on Telegram $\to$ `/newbot` $\to$ Copy the API token into `TELEGRAM_BOT_TOKEN`.
   - Message `@userinfobot` to get your personal numerical chat ID $\to$ `OPERATOR_TELEGRAM_CHAT_ID`.
4. **Meta for Developers (WhatsApp & Instagram):**
   - Register at [developers.facebook.com](https://developers.facebook.com/).
   - Add **WhatsApp** and **Instagram Graph API**.
   - Copy `App Secret` and generate a `System User Access Token`.

### Step 3: Deploy to Vercel (100% Free)

You can deploy directly using the Vercel CLI:
```bash
npm install -g vercel
vercel
```

During setup, configure your environment variables on the [Vercel Project Dashboard](https://vercel.com/dashboard) under **Settings** $\to$ **Environment Variables**:
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `OPERATOR_TELEGRAM_CHAT_ID`
- `META_APP_SECRET`
- `META_ACCESS_TOKEN`
- `META_VERIFY_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`

---

## 🔗 Registering Webhooks

Once your Vercel deployment provides your public URL (e.g., `https://your-bot.vercel.app`):

### 1. Register Meta Webhook
- In Meta App Dashboard $\to$ **Webhooks** $\to$ Edit Subscription:
  - **Callback URL:** `https://your-bot.vercel.app/api/webhook`
  - **Verify Token:** (Your `META_VERIFY_TOKEN` string)
- Subscribe to `messages` for WhatsApp and `messages` for Instagram.

### 2. Register Telegram Webhook
Run this in your browser or terminal to connect Telegram button clicks to your Vercel endpoint:
```bash
curl -F "url=https://your-bot.vercel.app/api/telegram" https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

---

## 🧪 Testing the Autonomous & HITL Workflows

### Test 1: Autonomous FAQ Reply
Send a message like: *"What is your return policy?"*
- **Outcome:** The agent retrieves the policy from Supabase pgvector, generates a friendly grounded reply via Gemini Flash, and sends it directly to the customer in $<2.5$ seconds. No operator intervention needed.

### Test 2: Sensitive Operation with Operator Confirmation
Send a message like: *"Please cancel my order #98214"*
1. The customer receives:  
   *"I've submitted an authorization request to cancel order #98214. A team manager will confirm shortly."*
2. You receive an alert card on your **Telegram app**:
   ```
   🚨 CONFIRMATION REQUIRED: Sensitive Customer Action
   👤 Channel: WHATSAPP (+14155552671)
   💬 Customer Request: "Please cancel my order #98214"
   🛠️ Requested Action: request_order_cancellation
   📦 Parameters: { "order_id": "98214" }
   [✅ Approve & Execute]   [❌ Reject Request]
   ```
3. When you tap **[✅ Approve & Execute]**, the bot automatically resolves the state, logs the audit trail, and replies to the customer:  
   *"Your cancellation request for order #98214 has been approved and processed successfully."*
