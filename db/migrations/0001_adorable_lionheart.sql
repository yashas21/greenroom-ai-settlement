CREATE TABLE `deal_clarifications` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`flag_type` text NOT NULL,
	`severity` text NOT NULL,
	`field` text,
	`issue` text NOT NULL,
	`extracted_value` text,
	`structured_value` text,
	`interpretation_a` text,
	`interpretation_b` text,
	`financial_impact` text,
	`recommended_clarification` text,
	`status` text DEFAULT 'open' NOT NULL,
	`dismissal_reason` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `deals` ADD `last_analyzed_at` integer;--> statement-breakpoint
ALTER TABLE `deals` ADD `extraction_confidence` real;