DROP INDEX "tenant_slack_settings_team_id_idx";--> statement-breakpoint
ALTER TABLE "tenant_slack_settings" ADD COLUMN "team_id_verified_at" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slack_settings_verified_team_id_idx" ON "tenant_slack_settings" USING btree ("team_id") WHERE "team_id_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "tenant_slack_settings_team_id_idx" ON "tenant_slack_settings" USING btree ("team_id");