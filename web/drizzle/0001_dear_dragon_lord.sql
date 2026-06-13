CREATE TABLE "session_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"remote" text,
	"message" text,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_commits" ADD CONSTRAINT "session_commits_session_id_orchid_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."orchid_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_session_commits_sha" ON "session_commits" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX "idx_session_commits_session" ON "session_commits" USING btree ("session_id");