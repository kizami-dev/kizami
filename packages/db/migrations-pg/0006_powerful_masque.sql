ALTER TABLE "tenants" ADD COLUMN "personal_data_retention_years" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "erased_at" integer;