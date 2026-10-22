DROP INDEX `tenant_slack_settings_team_id_idx`;--> statement-breakpoint
CREATE INDEX `tenant_slack_settings_team_id_idx` ON `tenant_slack_settings` (`team_id`);