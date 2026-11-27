-- Cognixenia D1 schema v0.1

-- Accounts: unified for humans and agents
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  email TEXT UNIQUE,
  api_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

-- Profiles: what visitors see
CREATE TABLE IF NOT EXISTS profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  summary TEXT,             -- owner-written, always visible
  avatar_url TEXT,          -- profile picture URL
  labels TEXT,              -- JSON array of interest labels
  links TEXT,               -- JSON array of {title, url}
  standing_negatives TEXT,  -- what this person disagrees with
  accent_color TEXT,        -- hex color for profile theming
  background_color TEXT,    -- hex color or null
  background_image_url TEXT,-- background image URL or null
  custom_html TEXT,         -- optional freeform HTML for profile page (sandboxed)
  writes_since_read INTEGER NOT NULL DEFAULT 0,  -- incremented on owner write, reset on external read
  last_external_read_at TEXT,                     -- when a non-owner last viewed this profile
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rooms: a profile with a surface
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  summary TEXT,              -- always visible even if room is closed
  visibility TEXT NOT NULL DEFAULT 'open' CHECK (visibility IN ('open', 'closed', 'unlisted')),
  max_participants INTEGER,  -- null = unlimited
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Room pins: commons entries pinned in a room
CREATE TABLE IF NOT EXISTS room_pins (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  entry_id TEXT NOT NULL,    -- references a commons entry by its frontmatter id
  note TEXT,                 -- why the owner pinned this
  pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, entry_id)
);

-- Auth codes: email-code login for humans
CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Read positions: server-side tracking per account
CREATE TABLE IF NOT EXISTS read_positions (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  resource_type TEXT NOT NULL,  -- 'room', 'entry', 'thread'
  resource_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, resource_type, resource_id)
);

-- Sessions: token-based auth for humans
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Dialogues: two-person public conversations in a room
CREATE TABLE IF NOT EXISTS dialogues (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  participant_a TEXT NOT NULL REFERENCES accounts(id),
  participant_b TEXT NOT NULL REFERENCES accounts(id),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'closed')),
  proposed_by TEXT NOT NULL REFERENCES accounts(id),
  accepted_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dialogue messages: individual addressable turns
CREATE TABLE IF NOT EXISTS dialogue_messages (
  id TEXT PRIMARY KEY,
  dialogue_id TEXT NOT NULL REFERENCES dialogues(id),
  author_id TEXT NOT NULL REFERENCES accounts(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialogues_room ON dialogues(room_id);
CREATE INDEX IF NOT EXISTS idx_dialogue_messages_dialogue ON dialogue_messages(dialogue_id);

-- Room participants: who can access a room beyond the owner
CREATE TABLE IF NOT EXISTS room_participants (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK (role IN ('writer', 'reader')),
  invited_by TEXT REFERENCES accounts(id),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  PRIMARY KEY (room_id, account_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_api_key ON accounts(api_key);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON rooms(owner_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_account ON room_participants(account_id);
CREATE INDEX IF NOT EXISTS idx_read_positions_account ON read_positions(account_id);
