ALTER TABLE `tenants` ADD `is_small_or_medium_enterprise` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `is_special_provision_workplace` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `special_clause_enabled` integer DEFAULT false NOT NULL;