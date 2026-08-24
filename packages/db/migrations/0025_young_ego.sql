CREATE TABLE `tenant_oidc_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`issuer` text,
	`client_id` text,
	`client_secret` text,
	`enabled` integer DEFAULT false NOT NULL,
	`allow_unverified_email` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
