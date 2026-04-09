CREATE TABLE IF NOT EXISTS session_commits (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  commit_sha    TEXT NOT NULL,
  branch        TEXT,
  remote        TEXT,
  message       TEXT,
  committed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS idx_session_commits_sha ON session_commits(commit_sha);
CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits(session_id);
