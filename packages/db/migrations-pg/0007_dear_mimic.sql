CREATE TABLE "pending_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"organization_name" text NOT NULL,
	"admin_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"invite_code_id" text,
	"expires_at" integer NOT NULL,
	"consumed_at" integer,
	"tenant_id" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_invite_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" integer,
	"revoked_at" integer,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_signups" ADD CONSTRAINT "pending_signups_invite_code_id_signup_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "signup_invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_signups" ADD CONSTRAINT "pending_signups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_signups_token_hash_idx" ON "pending_signups" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pending_signups_email_idx" ON "pending_signups" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pending_signups_expires_at_idx" ON "pending_signups" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_invite_codes_code_hash_idx" ON "signup_invite_codes" USING btree ("code_hash");