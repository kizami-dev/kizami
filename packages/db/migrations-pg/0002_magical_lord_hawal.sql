CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys_p256dh" text NOT NULL,
	"keys_auth" text NOT NULL,
	"user_agent" text,
	"created_at" integer NOT NULL,
	"last_used_at" integer,
	"failed_at" integer
);
--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "missing_clock_out_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "overtime_alert_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "leave_alert_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "correction_alert_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "approval_request_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "shift_variance_push" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_endpoint_uq" ON "push_subscriptions" USING btree ("tenant_id","user_id","endpoint");