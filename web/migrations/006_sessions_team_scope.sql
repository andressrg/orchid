ALTER TABLE orchid_sessions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES "user"(id);
ALTER TABLE orchid_sessions ADD COLUMN IF NOT EXISTS team_id TEXT REFERENCES organization(id);
CREATE INDEX IF NOT EXISTS idx_orchid_sessions_team ON orchid_sessions(team_id);
CREATE INDEX IF NOT EXISTS idx_orchid_sessions_user ON orchid_sessions(user_id);
