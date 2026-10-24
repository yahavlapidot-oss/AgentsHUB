ALTER TABLE `agents` ADD `instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `approvals` ADD `consumed_at` integer;