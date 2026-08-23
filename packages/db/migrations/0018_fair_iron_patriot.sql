CREATE INDEX `allowance_definitions_tenant_idx` ON `allowance_definitions` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `auto_break_waivers_tenant_user_status_date_idx` ON `auto_break_waivers` (`tenant_id`,`user_id`,`status`,`waive_date`);--> statement-breakpoint
CREATE INDEX `leave_requests_tenant_user_status_date_idx` ON `leave_requests` (`tenant_id`,`user_id`,`status`,`leave_date`);