CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_date` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_tenant_user_type_subject_date_idx` ON `notifications` (`tenant_id`,`user_id`,`type`,`subject_date`);--> statement-breakpoint
CREATE INDEX `notifications_tenant_user_created_idx` ON `notifications` (`tenant_id`,`user_id`,`created_at`);