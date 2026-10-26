CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`label` text NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`agent_ids` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_error` text,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
