-- Migration 002: Add nickname + account metadata fields
ALTER TABLE accounts ADD COLUMN nickname TEXT;
ALTER TABLE accounts ADD COLUMN avatar_url TEXT;
ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 0;
