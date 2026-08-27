CREATE TABLE `worker_heartbeats` (
	`job_name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`last_result` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `punch_events_occurred_idx` ON `punch_events` (`occurred_at`);