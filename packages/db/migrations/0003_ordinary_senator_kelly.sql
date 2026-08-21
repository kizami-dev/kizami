CREATE TABLE `tenant_notification_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`webhook_enabled` integer DEFAULT false NOT NULL,
	`webhook_url` text,
	`smtp_enabled` integer DEFAULT false NOT NULL,
	`smtp_host` text,
	`smtp_port` integer,
	`smtp_user` text,
	`smtp_password` text,
	`smtp_from` text,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
