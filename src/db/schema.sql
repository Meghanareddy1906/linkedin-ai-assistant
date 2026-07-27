-- LinkedIn Assistant - Database Schema
-- Run this in Supabase's SQL Editor (Dashboard -> SQL Editor -> New query)

-- Tracks each conversation we've scraped, so we know what's already been
-- read and don't need to re-scrape from scratch every time.
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  participant_name TEXT UNIQUE NOT NULL,
  last_scraped_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INT DEFAULT 0
);

-- Stores individual messages within each conversation. The UNIQUE
-- constraint prevents the same message being inserted twice if the
-- scraper runs again over an already-processed conversation.
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT,
  message_text TEXT NOT NULL,
  message_timestamp TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, sender, message_text, message_timestamp)
);

-- Stores AI-drafted replies per conversation, so we don't re-draft a
-- reply if nothing new has come in since the last draft. The "approved"
-- column tracks whether the user approved this draft via WhatsApp.
CREATE TABLE IF NOT EXISTS drafted_replies (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  draft_text TEXT NOT NULL,
  based_on_message_count INT NOT NULL,
  approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks suggested connections and drafted outreach notes, so we don't
-- redraft a note for someone we've already processed. Deduped by name,
-- since LinkedIn's suggestion cards don't expose a real profile link in
-- their HTML (navigation happens via JS click handler, not a real <a>).
-- The "approved" column tracks whether the user approved this note via
-- WhatsApp.
CREATE TABLE IF NOT EXISTS connections (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  headline TEXT,
  profile_url TEXT,
  draft_note TEXT,
  approved BOOLEAN DEFAULT FALSE,
  drafted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Speeds up lookups by conversation when checking for existing messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
