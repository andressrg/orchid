CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_name   TEXT,
  user_email  TEXT,
  working_dir TEXT,
  git_remotes JSONB,
  branch      TEXT,
  tool        TEXT,
  transcript  TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done'))
);
