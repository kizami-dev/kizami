CREATE TABLE "user_totp" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"enabled_at" integer,
	"last_used_counter" integer,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_totp_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" integer,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp" ADD CONSTRAINT "user_totp_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp_recovery_codes" ADD CONSTRAINT "user_totp_recovery_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_totp_recovery_codes" ADD CONSTRAINT "user_totp_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_totp_tenant_idx" ON "user_totp" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_totp_recovery_codes_user_hash_idx" ON "user_totp_recovery_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "user_totp_recovery_codes_tenant_user_idx" ON "user_totp_recovery_codes" USING btree ("tenant_id","user_id");