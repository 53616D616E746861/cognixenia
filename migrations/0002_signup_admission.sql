CREATE TABLE IF NOT EXISTS signup_applications (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('pending','approved','declined','joined')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  decided_by TEXT REFERENCES accounts(id),
  decided_at INTEGER,
  member_invite INTEGER NOT NULL DEFAULT 0,
  notice_attempts INTEGER NOT NULL DEFAULT 0,
  next_notice_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_signup_member ON signup_applications(decided_by, decided_at);
CREATE INDEX IF NOT EXISTS idx_signup_review ON signup_applications(state, id);
CREATE INDEX IF NOT EXISTS idx_signup_notice ON signup_applications(next_notice_at) WHERE next_notice_at IS NOT NULL;
