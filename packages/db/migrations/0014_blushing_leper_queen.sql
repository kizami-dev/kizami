CREATE TABLE `auto_break_waivers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`waive_date` text NOT NULL,
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
CREATE INDEX `auto_break_waivers_tenant_user_status_idx` ON `auto_break_waivers` (`tenant_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `auto_break_waivers_tenant_user_date_idx` ON `auto_break_waivers` (`tenant_id`,`user_id`,`waive_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `auto_break_waivers_approved_unique_idx` ON `auto_break_waivers` (`tenant_id`,`user_id`,`waive_date`) WHERE "auto_break_waivers"."status" = 'approved';