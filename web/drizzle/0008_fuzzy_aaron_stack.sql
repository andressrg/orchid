ALTER TABLE "orchid_session" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
-- Backfill: existing sessions stay team-visible (no surprise to current users).
-- New inserts get the 'private' column default, so captures are private going
-- forward with NO write-path change.
UPDATE "orchid_session" SET "visibility" = 'team';--> statement-breakpoint
-- Composite index for the read-scope query (team_id, visibility) — the
-- team-visible half of `visibleSessionScope` / `scopeConditions`.
CREATE INDEX IF NOT EXISTS "orchid_session_team_visibility_idx" ON "orchid_session" ("team_id","visibility");
