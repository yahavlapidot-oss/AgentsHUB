CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `autonomy` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `approvals` ADD `service` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `approvals` ADD `details` text DEFAULT '' NOT NULL;