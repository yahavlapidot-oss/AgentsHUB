CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`acceptance_criteria` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`project_id` text,
	`owner_agent_id` text,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`interval_minutes` integer,
	`time_of_day` text DEFAULT '08:00' NOT NULL,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`day_of_month` integer,
	`timezone` text DEFAULT 'Asia/Jerusalem' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`skip_if_open` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_task_id` text,
	`run_count` integer DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedules_next_idx` ON `schedules` (`next_run_at`);