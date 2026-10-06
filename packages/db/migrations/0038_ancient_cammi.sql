CREATE INDEX `closing_events_tenant_id_idx` ON `closing_events` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `closing_snapshots_tenant_id_idx` ON `closing_snapshots` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `correction_requests_tenant_id_idx` ON `correction_requests` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `notifications_tenant_id_idx` ON `notifications` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `punch_events_tenant_id_idx` ON `punch_events` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `shift_days_tenant_id_idx` ON `shift_days` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `leave_requests_tenant_id_idx` ON `leave_requests` (`tenant_id`,`id`);