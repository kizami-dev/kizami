CREATE TABLE `user_notification_settings` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`missing_clock_out_email` integer DEFAULT false NOT NULL,
	`missing_clock_out_webhook` integer DEFAULT false NOT NULL,
	`overtime_alert_email` integer DEFAULT false NOT NULL,
	`overtime_alert_webhook` integer DEFAULT false NOT NULL,
	`leave_alert_email` integer DEFAULT false NOT NULL,
	`leave_alert_webhook` integer DEFAULT false NOT NULL,
	`email_address` text,
	`webhook_url` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
