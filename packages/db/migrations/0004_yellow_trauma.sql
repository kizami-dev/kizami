CREATE TABLE `closing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`period` text NOT NULL,
	`event` text NOT NULL,
	`actor_id` text NOT NULL,
	`note` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `closing_events_tenant_period_occurred_idx` ON `closing_events` (`tenant_id`,`period`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `closing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`closing_event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`minutes` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closing_event_id`) REFERENCES `closing_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `closing_snapshots_tenant_event_idx` ON `closing_snapshots` (`tenant_id`,`closing_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `closing_snapshots_event_user_category_idx` ON `closing_snapshots` (`closing_event_id`,`user_id`,`category`);