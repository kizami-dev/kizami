CREATE TABLE `leave_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`granted_on` text NOT NULL,
	`days` integer NOT NULL,
	`expires_on` text NOT NULL,
	`source` text NOT NULL,
	`converted_from_grant_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leave_grants_tenant_user_idx` ON `leave_grants` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `leave_grants_converted_from_idx` ON `leave_grants` (`converted_from_grant_id`);--> statement-breakpoint
CREATE TABLE `leave_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`leave_date` text NOT NULL,
	`unit` text NOT NULL,
	`minutes` integer,
	`leave_type` text NOT NULL,
	`reason` text NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leave_requests_tenant_user_status_idx` ON `leave_requests` (`tenant_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `leave_requests_tenant_user_date_idx` ON `leave_requests` (`tenant_id`,`user_id`,`leave_date`);--> statement-breakpoint
CREATE TABLE `tenant_leave_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`grant_method` text NOT NULL,
	`fixed_date_mm_dd` text,
	`hourly_leave_enabled` integer DEFAULT false NOT NULL,
	`hourly_leave_max_days` integer DEFAULT 5 NOT NULL,
	`half_day_leave_enabled` integer DEFAULT true NOT NULL,
	`stock_conversion_enabled` integer DEFAULT false NOT NULL,
	`stock_max_days` integer DEFAULT 40 NOT NULL,
	`stock_expires_months` integer,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `hire_date` text;