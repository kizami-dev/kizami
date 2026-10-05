CREATE TABLE "scheduled_holiday_calendar_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"weekdays" text NOT NULL,
	"national_holidays" integer NOT NULL,
	"extra_holidays" text NOT NULL,
	"extra_workdays" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_policy_versions" ADD COLUMN "flex_total_hours_basis" text DEFAULT 'statutory_frame' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_policy_versions" ADD COLUMN "flex_carry_over_shortfall" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_holiday_calendar_versions" ADD CONSTRAINT "scheduled_holiday_calendar_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_holiday_calendar_versions_tenant_effective_idx" ON "scheduled_holiday_calendar_versions" USING btree ("tenant_id","effective_from");