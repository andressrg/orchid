CREATE TABLE IF NOT EXISTS session_commits (
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  commit_sha    TEXT NOT NULL,
  branch        TEXT,
  remote        TEXT,
  message       TEXT,
  committed_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (session_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS idx_session_commits_sha ON session_commits(commit_sha);
CREATE INDEX IF NOT EXISTS idx_session_commits_session ON session_commits(session_id);
