CREATE TABLE `user_totp` (
	`user_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`secret_encrypted` text NOT NULL,
	`enabled_at` integer,
	`last_used_counter` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_totp_tenant_idx` ON `user_totp` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `user_totp_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_totp_recovery_codes_user_hash_idx` ON `user_totp_recovery_codes` (`user_id`,`code_hash`);--> statement-breakpoint
CREATE INDEX `user_totp_recovery_codes_tenant_user_idx` ON `user_totp_recovery_codes` (`tenant_id`,`user_id`);