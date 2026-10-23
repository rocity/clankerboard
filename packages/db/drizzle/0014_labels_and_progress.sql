CREATE TYPE "public"."label_color" AS ENUM('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink');--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" "label_color" NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_one_creator" CHECK (num_nonnulls("labels"."created_by_user_id", "labels"."created_by_agent_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ticket_labels" (
	"ticket_id" text NOT NULL,
	"label_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_labels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "progress" integer;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_company_name_unique" ON "labels" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ticket_labels_label_id_index" ON "ticket_labels" USING btree ("label_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_progress_range" CHECK ("tickets"."progress" between 0 and 100);