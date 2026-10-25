ALTER TABLE `messages` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `messages_project_idx` ON `messages` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `lead_agent_id` text;