CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`agent_id` text,
	`run_id` text,
	`sandbox_id` text,
	`path` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_task_idx` ON `artifacts` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_task_path_version` ON `artifacts` (`task_id`,`path`,`version`);--> statement-breakpoint
CREATE TABLE `sandboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text,
	`run_id` text,
	`provider` text NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'starting' NOT NULL,
	`commands` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`ended_at` integer
);
--> statement-breakpoint
CREATE INDEX `sandboxes_status_idx` ON `sandboxes` (`status`);--> statement-breakpoint
CREATE INDEX `sandboxes_task_idx` ON `sandboxes` (`task_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `sandbox_enabled` integer DEFAULT false NOT NULL;