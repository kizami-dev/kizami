CREATE TABLE `approval_flow_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`correction_steps` integer DEFAULT 1 NOT NULL,
	`leave_steps` integer DEFAULT 1 NOT NULL,
	`auto_break_waiver_steps` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `auto_break_waivers` ADD `required_steps` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `auto_break_waivers` ADD `step1_decided_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `auto_break_waivers` ADD `step1_decided_at` integer;--> statement-breakpoint
ALTER TABLE `correction_requests` ADD `required_steps` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `correction_requests` ADD `step1_decided_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `correction_requests` ADD `step1_decided_at` integer;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `required_steps` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `step1_decided_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `step1_decided_at` integer;