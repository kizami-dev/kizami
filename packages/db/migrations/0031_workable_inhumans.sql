ALTER TABLE `tenants` ADD `personal_data_retention_years` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deactivated_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `erased_at` integer;