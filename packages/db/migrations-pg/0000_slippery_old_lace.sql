CREATE TABLE "allowance_definition_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"definition_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"name" text NOT NULL,
	"conditions" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowance_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text NOT NULL,
	"expires_at" integer,
	"last_used_at" integer,
	"revoked_at" integer,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"before_digest" text,
	"after_digest" text,
	"occurred_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_break_waivers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"waive_date" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text,
	"decided_at" integer,
	"decision_note" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period" text NOT NULL,
	"event" text NOT NULL,
	"actor_id" text NOT NULL,
	"note" text,
	"correction_request_id" text,
	"leave_request_id" text,
	"occurred_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closing_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"closing_event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"target_event_id" text,
	"proposed_kind" text,
	"proposed_occurred_at" integer,
	"reason" text NOT NULL,
	"decided_by" text,
	"decided_at" integer,
	"decision_note" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_overrides" (
	"tenant_id" text NOT NULL,
	"help_key" text NOT NULL,
	"body_md" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" integer NOT NULL,
	CONSTRAINT "help_overrides_tenant_id_help_key_pk" PRIMARY KEY("tenant_id","help_key")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"accepted_at" integer,
	"revoked_at" integer,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_grant_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"leave_type" text NOT NULL,
	"granted_on" text NOT NULL,
	"days" integer NOT NULL,
	"expires_on" text NOT NULL,
	"attendance_rate" text NOT NULL,
	"status" text NOT NULL,
	"proposed_at" integer NOT NULL,
	"decided_by" text,
	"decided_at" integer,
	"decision_note" text,
	"grant_id" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"leave_type" text NOT NULL,
	"granted_on" text NOT NULL,
	"days" integer NOT NULL,
	"expires_on" text NOT NULL,
	"source" text NOT NULL,
	"converted_from_grant_id" text,
	"note" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text NOT NULL,
	"leave_date" text NOT NULL,
	"unit" text NOT NULL,
	"minutes" integer,
	"leave_type" text NOT NULL,
	"reason" text NOT NULL,
	"decided_by" text,
	"decided_at" integer,
	"decision_note" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"department_id" text NOT NULL,
	"title" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"subject_date" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" integer NOT NULL,
	"read_at" integer
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" integer,
	"revoked_at" integer,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"grants" text NOT NULL,
	"is_system" integer DEFAULT 0 NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preset_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"preset_id" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "punch_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" integer NOT NULL,
	"recorded_at" integer NOT NULL,
	"source" text NOT NULL,
	"actor_id" text NOT NULL,
	"supersedes_id" text,
	"correction_request_id" text,
	"note" text,
	"meta_ip" text,
	"meta_ua" text,
	"meta_gps_lat" double precision,
	"meta_gps_lng" double precision
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" integer NOT NULL,
	"expires_at" integer NOT NULL,
	"revoked_at" integer
);
--> statement-breakpoint
CREATE TABLE "shift_days" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"day_type" text NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"pattern_id" text,
	"plan_id" text NOT NULL,
	"supersedes_id" text,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"day_type" text NOT NULL,
	"start_minutes" integer NOT NULL,
	"end_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"created_at" integer NOT NULL,
	"archived_at" integer
);
--> statement-breakpoint
CREATE TABLE "shift_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"published_at" integer,
	"published_by" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" integer,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_links" (
	"tenant_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"linked_at" integer NOT NULL,
	CONSTRAINT "slack_user_links_tenant_id_slack_user_id_pk" PRIMARY KEY("tenant_id","slack_user_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_leave_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"grant_method" text NOT NULL,
	"fixed_date_mm_dd" text,
	"hourly_leave_enabled" integer DEFAULT 0 NOT NULL,
	"hourly_leave_max_days" integer DEFAULT 5 NOT NULL,
	"half_day_leave_enabled" integer DEFAULT 1 NOT NULL,
	"stock_conversion_enabled" integer DEFAULT 0 NOT NULL,
	"stock_max_days" integer DEFAULT 40 NOT NULL,
	"stock_expires_months" integer,
	"updated_at" integer NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_notification_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"webhook_enabled" integer DEFAULT 0 NOT NULL,
	"webhook_url" text,
	"smtp_enabled" integer DEFAULT 0 NOT NULL,
	"smtp_host" text,
	"smtp_port" integer,
	"smtp_user" text,
	"smtp_password" text,
	"smtp_from" text,
	"updated_at" integer NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_oidc_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"issuer" text,
	"client_id" text,
	"client_secret" text,
	"enabled" integer DEFAULT 0 NOT NULL,
	"allow_unverified_email" integer DEFAULT 0 NOT NULL,
	"updated_at" integer NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_setting_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"day_boundary_minutes" integer NOT NULL,
	"legal_holiday_rule" text NOT NULL,
	"break_rule" text NOT NULL,
	"gps_enabled" integer NOT NULL,
	"gps_retention_days" integer,
	"week_start_weekday" integer DEFAULT 0 NOT NULL,
	"variable_period_start_day" integer DEFAULT 1 NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_slack_settings" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"signing_secret" text,
	"enabled" integer DEFAULT 0 NOT NULL,
	"updated_at" integer NOT NULL,
	"updated_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_small_or_medium_enterprise" integer DEFAULT 1 NOT NULL,
	"is_special_provision_workplace" integer DEFAULT 0 NOT NULL,
	"special_clause_enabled" integer DEFAULT 0 NOT NULL,
	"work_rules_url" text,
	"record_retention_description" text,
	"privacy_contact_point" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_settings" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"missing_clock_out_email" integer DEFAULT 0 NOT NULL,
	"missing_clock_out_webhook" integer DEFAULT 0 NOT NULL,
	"overtime_alert_email" integer DEFAULT 0 NOT NULL,
	"overtime_alert_webhook" integer DEFAULT 0 NOT NULL,
	"leave_alert_email" integer DEFAULT 0 NOT NULL,
	"leave_alert_webhook" integer DEFAULT 0 NOT NULL,
	"correction_alert_email" integer DEFAULT 0 NOT NULL,
	"correction_alert_webhook" integer DEFAULT 0 NOT NULL,
	"approval_request_email" integer DEFAULT 0 NOT NULL,
	"approval_request_webhook" integer DEFAULT 0 NOT NULL,
	"shift_variance_email" integer DEFAULT 0 NOT NULL,
	"shift_variance_webhook" integer DEFAULT 0 NOT NULL,
	"email_address" text,
	"webhook_url" text,
	"updated_at" integer NOT NULL,
	CONSTRAINT "user_notification_settings_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_policy_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"work_policy_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"hire_date" text,
	"leave_grant_class" text DEFAULT 'full' NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"work_policy_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"kind" text DEFAULT 'flex' NOT NULL,
	"settlement_period" text NOT NULL,
	"core" text,
	"standard_day_minutes" integer NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allowance_definition_versions" ADD CONSTRAINT "allowance_definition_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowance_definition_versions" ADD CONSTRAINT "allowance_definition_versions_definition_id_allowance_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "allowance_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowance_definitions" ADD CONSTRAINT "allowance_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD CONSTRAINT "auto_break_waivers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD CONSTRAINT "auto_break_waivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD CONSTRAINT "auto_break_waivers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_break_waivers" ADD CONSTRAINT "auto_break_waivers_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_events" ADD CONSTRAINT "closing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_events" ADD CONSTRAINT "closing_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_events" ADD CONSTRAINT "closing_events_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "correction_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_events" ADD CONSTRAINT "closing_events_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_snapshots" ADD CONSTRAINT "closing_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_snapshots" ADD CONSTRAINT "closing_snapshots_closing_event_id_closing_events_id_fk" FOREIGN KEY ("closing_event_id") REFERENCES "closing_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_snapshots" ADD CONSTRAINT "closing_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_target_event_id_punch_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "punch_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_overrides" ADD CONSTRAINT "help_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_overrides" ADD CONSTRAINT "help_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_proposals" ADD CONSTRAINT "leave_grant_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_proposals" ADD CONSTRAINT "leave_grant_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_proposals" ADD CONSTRAINT "leave_grant_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grant_proposals" ADD CONSTRAINT "leave_grant_proposals_grant_id_leave_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "leave_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grants" ADD CONSTRAINT "leave_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_grants" ADD CONSTRAINT "leave_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_presets" ADD CONSTRAINT "permission_presets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_assignments" ADD CONSTRAINT "preset_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_assignments" ADD CONSTRAINT "preset_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_assignments" ADD CONSTRAINT "preset_assignments_preset_id_permission_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "permission_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "punch_events" ADD CONSTRAINT "punch_events_supersedes_id_punch_events_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "punch_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_pattern_id_shift_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "shift_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_plan_id_shift_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "shift_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_supersedes_id_shift_days_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "shift_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_days" ADD CONSTRAINT "shift_days_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_patterns" ADD CONSTRAINT "shift_patterns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_plans" ADD CONSTRAINT "shift_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_plans" ADD CONSTRAINT "shift_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_plans" ADD CONSTRAINT "shift_plans_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_link_tokens" ADD CONSTRAINT "slack_link_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_leave_settings" ADD CONSTRAINT "tenant_leave_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_leave_settings" ADD CONSTRAINT "tenant_leave_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" ADD CONSTRAINT "tenant_notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_notification_settings" ADD CONSTRAINT "tenant_notification_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_oidc_settings" ADD CONSTRAINT "tenant_oidc_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_oidc_settings" ADD CONSTRAINT "tenant_oidc_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_setting_versions" ADD CONSTRAINT "tenant_setting_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_slack_settings" ADD CONSTRAINT "tenant_slack_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_slack_settings" ADD CONSTRAINT "tenant_slack_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_policy_assignments" ADD CONSTRAINT "user_policy_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_policy_assignments" ADD CONSTRAINT "user_policy_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_policy_assignments" ADD CONSTRAINT "user_policy_assignments_work_policy_id_work_policies_id_fk" FOREIGN KEY ("work_policy_id") REFERENCES "work_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policies" ADD CONSTRAINT "work_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_versions" ADD CONSTRAINT "work_policy_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_policy_versions" ADD CONSTRAINT "work_policy_versions_work_policy_id_work_policies_id_fk" FOREIGN KEY ("work_policy_id") REFERENCES "work_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allowance_definition_versions_tenant_effective_idx" ON "allowance_definition_versions" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE INDEX "allowance_definition_versions_definition_effective_idx" ON "allowance_definition_versions" USING btree ("definition_id","effective_from");--> statement-breakpoint
CREATE INDEX "allowance_definitions_tenant_idx" ON "allowance_definitions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_user_idx" ON "api_keys" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_occurred_idx" ON "audit_logs" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_credentials_user_idx" ON "auth_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auto_break_waivers_tenant_user_status_idx" ON "auto_break_waivers" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE INDEX "auto_break_waivers_tenant_user_date_idx" ON "auto_break_waivers" USING btree ("tenant_id","user_id","waive_date");--> statement-breakpoint
CREATE INDEX "auto_break_waivers_tenant_user_status_date_idx" ON "auto_break_waivers" USING btree ("tenant_id","user_id","status","waive_date");--> statement-breakpoint
CREATE UNIQUE INDEX "auto_break_waivers_approved_unique_idx" ON "auto_break_waivers" USING btree ("tenant_id","user_id","waive_date") WHERE "status" = 'approved';--> statement-breakpoint
CREATE INDEX "closing_events_tenant_period_occurred_idx" ON "closing_events" USING btree ("tenant_id","period","occurred_at");--> statement-breakpoint
CREATE INDEX "closing_snapshots_tenant_event_idx" ON "closing_snapshots" USING btree ("tenant_id","closing_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "closing_snapshots_event_user_category_idx" ON "closing_snapshots" USING btree ("closing_event_id","user_id","category");--> statement-breakpoint
CREATE INDEX "correction_requests_tenant_user_status_idx" ON "correction_requests" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE INDEX "correction_requests_tenant_status_idx" ON "correction_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "departments_tenant_parent_idx" ON "departments" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_idx" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_user_idx" ON "invitations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "leave_grant_proposals_tenant_status_idx" ON "leave_grant_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leave_grant_proposals_lookup_idx" ON "leave_grant_proposals" USING btree ("tenant_id","user_id","leave_type","granted_on");--> statement-breakpoint
CREATE INDEX "leave_grants_tenant_user_idx" ON "leave_grants" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "leave_grants_converted_from_idx" ON "leave_grants" USING btree ("converted_from_grant_id");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_user_status_idx" ON "leave_requests" USING btree ("tenant_id","user_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_user_date_idx" ON "leave_requests" USING btree ("tenant_id","user_id","leave_date");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_user_status_date_idx" ON "leave_requests" USING btree ("tenant_id","user_id","status","leave_date");--> statement-breakpoint
CREATE INDEX "memberships_tenant_user_idx" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_department_idx" ON "memberships" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_user_type_subject_date_idx" ON "notifications" USING btree ("tenant_id","user_id","type","subject_date");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_created_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_tenant_user_idx" ON "password_reset_tokens" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "preset_assignments_tenant_user_idx" ON "preset_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preset_assignments_user_preset_idx" ON "preset_assignments" USING btree ("user_id","preset_id");--> statement-breakpoint
CREATE INDEX "punch_events_tenant_user_occurred_idx" ON "punch_events" USING btree ("tenant_id","user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "punch_events_supersedes_idx" ON "punch_events" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_user_idx" ON "sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "shift_days_tenant_user_date_idx" ON "shift_days" USING btree ("tenant_id","user_id","date");--> statement-breakpoint
CREATE INDEX "shift_days_plan_idx" ON "shift_days" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_days_supersedes_idx" ON "shift_days" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "shift_patterns_tenant_idx" ON "shift_patterns" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shift_plans_tenant_user_period_idx" ON "shift_plans" USING btree ("tenant_id","user_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_link_tokens_token_hash_idx" ON "slack_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "slack_link_tokens_tenant_slack_user_idx" ON "slack_link_tokens" USING btree ("tenant_id","slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_links_tenant_user_idx" ON "slack_user_links" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "tenant_setting_versions_tenant_effective_idx" ON "tenant_setting_versions" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slack_settings_team_id_idx" ON "tenant_slack_settings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "user_policy_assignments_tenant_user_effective_idx" ON "user_policy_assignments" USING btree ("tenant_id","user_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "work_policy_versions_tenant_effective_idx" ON "work_policy_versions" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE INDEX "work_policy_versions_policy_effective_idx" ON "work_policy_versions" USING btree ("work_policy_id","effective_from");