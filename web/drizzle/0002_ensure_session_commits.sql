-- Corrective, idempotent: ensure `session_commits` exists.
-- The 0001 migration that creates it was baselined (recorded as applied without
-- replaying its SQL) on DBs whose schema pre-existed via `drizzle push` — but on
-- DBs where the table never actually existed, the CREATE was skipped. This heals
-- that: it creates the table where missing and is a safe no-op where present.
CREATE TABLE IF NOT EXISTS "session_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"remote" text,
	"message" text,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "session_commits" ADD CONSTRAINT "session_commits_session_id_orchid_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."orchid_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
	WHEN duplicate_table THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_commits_sha" ON "session_commits" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_commits_session" ON "session_commits" USING btree ("session_id");
