CREATE INDEX `events_run_idx` ON `events` (`run_id`);--> statement-breakpoint
CREATE INDEX `runs_task_idx` ON `runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `runs_started_idx` ON `runs` (`started_at`);