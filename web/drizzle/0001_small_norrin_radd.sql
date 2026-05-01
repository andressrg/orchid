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
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "session_commits" ADD CONSTRAINT "session_commits_session_id_orchid_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."orchid_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_session_commits_sha" ON "session_commits" USING btree ("commit_sha");--> statement-breakpoint
CREATE INDEX "idx_session_commits_session" ON "session_commits" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_commits_session_commit_uidx" ON "session_commits" USING btree ("session_id","commit_sha");--> statement-breakpoint
CREATE INDEX "idx_subscription_reference" ON "subscription" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_stripe_customer" ON "subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_stripe_subscription" ON "subscription" USING btree ("stripe_subscription_id");
