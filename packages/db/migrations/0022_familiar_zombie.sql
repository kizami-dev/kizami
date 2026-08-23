CREATE TABLE `leave_grant_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`granted_on` text NOT NULL,
	`days` integer NOT NULL,
	`expires_on` text NOT NULL,
	`attendance_rate` text NOT NULL,
	`status` text NOT NULL,
	`proposed_at` integer NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`grant_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`grant_id`) REFERENCES `leave_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `leave_grant_proposals_tenant_status_idx` ON `leave_grant_proposals` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `leave_grant_proposals_lookup_idx` ON `leave_grant_proposals` (`tenant_id`,`user_id`,`leave_type`,`granted_on`);