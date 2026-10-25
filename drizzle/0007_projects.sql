CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`member_agent_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `artifacts` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `artifacts_project_idx` ON `artifacts` (`project_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `tasks_project_idx` ON `tasks` (`project_id`);