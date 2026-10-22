CREATE TYPE "public"."ticket_link_kind" AS ENUM('blocks', 'relates_to');--> statement-breakpoint
CREATE TABLE "ticket_links" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"from_ticket_id" text NOT NULL,
	"to_ticket_id" text NOT NULL,
	"kind" "ticket_link_kind" NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_links_not_self" CHECK ("ticket_links"."from_ticket_id" <> "ticket_links"."to_ticket_id"),
	CONSTRAINT "ticket_links_one_creator" CHECK (num_nonnulls("ticket_links"."created_by_user_id", "ticket_links"."created_by_agent_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "estimate" integer;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_from_ticket_id_tickets_id_fk" FOREIGN KEY ("from_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_to_ticket_id_tickets_id_fk" FOREIGN KEY ("to_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_links_pair_unique" ON "ticket_links" USING btree (least("from_ticket_id", "to_ticket_id"),greatest("from_ticket_id", "to_ticket_id"));--> statement-breakpoint
CREATE INDEX "ticket_links_from_ticket_id_index" ON "ticket_links" USING btree ("from_ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_links_to_ticket_id_index" ON "ticket_links" USING btree ("to_ticket_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_estimate_range" CHECK ("tickets"."estimate" between 0 and 100);