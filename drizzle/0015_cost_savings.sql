ALTER TABLE `agents` ADD `cheap_model` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `cached_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `saved_usd` real DEFAULT 0 NOT NULL;