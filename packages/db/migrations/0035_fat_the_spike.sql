CREATE TABLE `scheduled_holiday_calendar_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`weekdays` text NOT NULL,
	`national_holidays` integer NOT NULL,
	`extra_holidays` text NOT NULL,
	`extra_workdays` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scheduled_holiday_calendar_versions_tenant_effective_idx` ON `scheduled_holiday_calendar_versions` (`tenant_id`,`effective_from`);--> statement-breakpoint
ALTER TABLE `work_policy_versions` ADD `flex_total_hours_basis` text DEFAULT 'statutory_frame' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_policy_versions` ADD `flex_carry_over_shortfall` integer DEFAULT false NOT NULL;