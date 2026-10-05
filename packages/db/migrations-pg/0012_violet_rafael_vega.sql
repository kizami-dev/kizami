CREATE TABLE "tenant_purge_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"withdrawal_requested_at" integer NOT NULL,
	"purge_started_at" integer NOT NULL,
	"purged_at" integer,
	"deleted_counts" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "withdrawal_requested_at" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "withdrawal_scheduled_purge_at" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "withdrawal_reminder_sent_at" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "withdrawal_purge_started_at" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_purge_records_tenant_id_idx" ON "tenant_purge_records" USING btree ("tenant_id");