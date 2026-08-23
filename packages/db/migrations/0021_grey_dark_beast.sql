CREATE TABLE `shift_days` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`day_type` text NOT NULL,
	`start_minutes` integer NOT NULL,
	`end_minutes` integer NOT NULL,
	`break_minutes` integer NOT NULL,
	`pattern_id` text,
	`plan_id` text NOT NULL,
	`supersedes_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pattern_id`) REFERENCES `shift_patterns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `shift_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_id`) REFERENCES `shift_days`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shift_days_tenant_user_date_idx` ON `shift_days` (`tenant_id`,`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `shift_days_plan_idx` ON `shift_days` (`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shift_days_supersedes_idx` ON `shift_days` (`supersedes_id`);--> statement-breakpoint
CREATE TABLE `shift_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`day_type` text NOT NULL,
	`start_minutes` integer NOT NULL,
	`end_minutes` integer NOT NULL,
	`break_minutes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shift_patterns_tenant_idx` ON `shift_patterns` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `shift_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`published_at` integer,
	`published_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shift_plans_tenant_user_period_idx` ON `shift_plans` (`tenant_id`,`user_id`,`period_start`);--> statement-breakpoint
ALTER TABLE `tenant_setting_versions` ADD `variable_period_start_day` integer DEFAULT 1 NOT NULL;