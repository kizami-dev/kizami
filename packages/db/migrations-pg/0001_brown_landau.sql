CREATE TABLE "approval_flow_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"correction_steps" integer DEFAULT 1 NOT NULL,
	"leave_steps" integer DEFAULT 1 NOT NULL,
	"auto_break_waiver_steps" integer DEFAULT 1 NOT NULL,
	"updated_at" integer NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD COLUMN "required_steps" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD COLUMN "step1_decided_by" text;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD COLUMN "step1_decided_at" integer;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "required_steps" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "step1_decided_by" text;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD COLUMN "step1_decided_at" integer;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "required_steps" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "step1_decided_by" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "step1_decided_at" integer;--> statement-breakpoint
ALTER TABLE "approval_flow_settings" ADD CONSTRAINT "approval_flow_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_flow_settings" ADD CONSTRAINT "approval_flow_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD CONSTRAINT "auto_break_waivers_step1_decided_by_users_id_fk" FOREIGN KEY ("step1_decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_step1_decided_by_users_id_fk" FOREIGN KEY ("step1_decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_step1_decided_by_users_id_fk" FOREIGN KEY ("step1_decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;