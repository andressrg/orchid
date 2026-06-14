-- Idempotent + dedup-safe unique index on (session_id, commit_sha).
--
-- This index makes commit↔session linking idempotent: both the transcript
-- extractor (PUT /sessions/:id) and the deterministic ingest endpoint
-- (POST /sessions/:id/commits) upsert with `ON CONFLICT (session_id,
-- commit_sha) DO NOTHING`, which REQUIRES this unique index to exist.
--
-- Prod predates the constraint, so `session_commits` may already hold duplicate
-- (session_id, commit_sha) rows. A bare CREATE UNIQUE INDEX would error on those.
-- So we first collapse duplicates — keep the earliest row per pair (oldest
-- created_at, then lowest id as a stable tiebreak) — then create the index
-- IF NOT EXISTS so re-runs are no-ops.
DELETE FROM "session_commits"
WHERE "session_commits"."id" IN (
  SELECT dup."id"
  FROM (
    SELECT "session_commits"."id",
           row_number() OVER (
             PARTITION BY "session_commits"."session_id", "session_commits"."commit_sha"
             ORDER BY "session_commits"."created_at" ASC, "session_commits"."id" ASC
           ) AS rn
    FROM "session_commits"
  ) AS dup
  WHERE dup.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_session_commits_session_sha" ON "session_commits" USING btree ("session_id","commit_sha");
