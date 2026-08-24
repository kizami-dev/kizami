CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`keys_p256dh` text NOT NULL,
	`keys_auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`failed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_user_endpoint_uq` ON `push_subscriptions` (`tenant_id`,`user_id`,`endpoint`);--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `missing_clock_out_push` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `overtime_alert_push` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `leave_alert_push` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `correction_alert_push` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `approval_request_push` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_notification_settings` ADD `shift_variance_push` integer DEFAULT false NOT NULL;