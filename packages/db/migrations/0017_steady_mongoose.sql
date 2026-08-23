CREATE TABLE `allowance_definition_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`name` text NOT NULL,
	`conditions` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`definition_id`) REFERENCES `allowance_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `allowance_definition_versions_tenant_effective_idx` ON `allowance_definition_versions` (`tenant_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `allowance_definition_versions_definition_effective_idx` ON `allowance_definition_versions` (`definition_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `allowance_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
