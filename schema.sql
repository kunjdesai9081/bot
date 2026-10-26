-- ========================================================
-- Supabase Schema for Social Support Agent with Vector RAG & HITL
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ========================================================

-- 1. Enable pgvector extension for AI semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Knowledge Base Table (Store FAQs, return policies, hours, etc.)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    category VARCHAR(64) NOT NULL DEFAULT 'faq',
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    embedding VECTOR(768), -- Dimension for Google text-embedding-004
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_kb_embedding ON knowledge_base 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Stored Procedure for Cosine Vector Similarity Search
CREATE OR REPLACE FUNCTION match_knowledge_base(
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.70,
    match_count INT DEFAULT 3
)
RETURNS TABLE (
    id BIGINT,
    question TEXT,
    answer TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.question,
        kb.answer,
        1 - (kb.embedding <=> query_embedding) AS similarity
    FROM knowledge_base kb
    WHERE 1 - (kb.embedding <=> query_embedding) > match_threshold
    ORDER BY kb.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 4. Customer Conversations Table (Tracks users across WhatsApp / Instagram)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel VARCHAR(32) NOT NULL, -- 'whatsapp' | 'instagram'
    channel_user_id VARCHAR(128) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(channel, channel_user_id)
);

-- 5. Chat History Table (Audit logs of conversation turns)
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender VARCHAR(16) NOT NULL, -- 'customer' | 'bot' | 'operator'
    content TEXT NOT NULL,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Pending Actions Table (Human-in-the-Loop approval records)
DO $$ BEGIN
    CREATE TYPE hitl_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'TIMED_OUT', 'EXECUTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    tool_name VARCHAR(64) NOT NULL,
    tool_arguments JSONB NOT NULL,
    customer_summary TEXT NOT NULL,
    status hitl_status DEFAULT 'PENDING',
    operator_id VARCHAR(64),
    operator_comment TEXT,
    telegram_message_id BIGINT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_status ON pending_actions(status);

-- 7. Seed Sample Knowledge Base (Embeddings can be generated via Google GenAI)
INSERT INTO knowledge_base (category, question, answer)
VALUES 
    ('policy', 'What is your return policy?', 'You can return any unworn, undamaged item in its original packaging within 30 days of delivery for a full refund.'),
    ('shipping', 'How long does shipping take?', 'Standard domestic shipping takes 3 to 5 business days. Express shipping takes 1 to 2 business days.'),
    ('hours', 'What are your customer service hours?', 'Our support team is active Monday through Friday, 9:00 AM to 6:00 PM EST. Our AI agent is available 24/7.')
ON CONFLICT DO NOTHING;
