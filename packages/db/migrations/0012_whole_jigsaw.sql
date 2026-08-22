CREATE TABLE `slack_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_link_tokens_token_hash_idx` ON `slack_link_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `slack_link_tokens_tenant_slack_user_idx` ON `slack_link_tokens` (`tenant_id`,`slack_user_id`);--> statement-breakpoint
CREATE TABLE `slack_user_links` (
	`tenant_id` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`user_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `slack_user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_user_links_tenant_user_idx` ON `slack_user_links` (`tenant_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `tenant_slack_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`team_id` text,
	`signing_secret` text,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_slack_settings_team_id_idx` ON `tenant_slack_settings` (`team_id`);