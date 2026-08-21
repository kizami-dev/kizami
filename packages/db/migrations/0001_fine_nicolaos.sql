CREATE TABLE `correction_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text NOT NULL,
	`target_event_id` text,
	`proposed_kind` text,
	`proposed_occurred_at` integer,
	`reason` text NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_event_id`) REFERENCES `punch_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `correction_requests_tenant_user_status_idx` ON `correction_requests` (`tenant_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `correction_requests_tenant_status_idx` ON `correction_requests` (`tenant_id`,`status`);