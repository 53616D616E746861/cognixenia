CREATE TABLE IF NOT EXISTS email_challenges (
  email TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  sent_count INTEGER NOT NULL,
  claim TEXT
);
CREATE INDEX IF NOT EXISTS idx_challenge_window ON email_challenges(window_start);

CREATE TABLE IF NOT EXISTS auth_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_limit_window ON auth_limits(window_start);

-- Pre-upgrade codes were logged. Require a newly delivered code.
DROP TABLE IF EXISTS auth_codes;
