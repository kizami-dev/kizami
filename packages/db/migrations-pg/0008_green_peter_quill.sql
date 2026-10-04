CREATE TABLE "password_reset_requests" (
	"email_key" text PRIMARY KEY NOT NULL,
	"requested_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD COLUMN "source" text DEFAULT 'admin' NOT NULL;