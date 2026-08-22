ALTER TABLE `tenant_setting_versions` ADD `week_start_weekday` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `work_policy_versions` ADD `kind` text DEFAULT 'flex' NOT NULL;