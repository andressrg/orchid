CREATE TABLE "session_share" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"grantee_user_id" text NOT NULL,
	"capability" text DEFAULT 'read' NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_session_id_orchid_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."orchid_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_grantee_user_id_user_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_share" ADD CONSTRAINT "session_share_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_session_share_session_grantee" ON "session_share" USING btree ("session_id","grantee_user_id");--> statement-breakpoint
CREATE INDEX "idx_session_share_grantee" ON "session_share" USING btree ("grantee_user_id");