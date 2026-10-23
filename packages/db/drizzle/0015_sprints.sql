CREATE TYPE "public"."sprint_state" AS ENUM('planned', 'active', 'finished');--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"state" "sprint_state" DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"ends_on" date,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_projectId_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "sprints_dates_match_state" CHECK (case "sprints"."state"
        when 'planned' then num_nonnulls("sprints"."started_at", "sprints"."ends_on", "sprints"."finished_at") = 0
        when 'active' then num_nonnulls("sprints"."started_at", "sprints"."ends_on") = 2 and "sprints"."finished_at" is null
        else num_nonnulls("sprints"."started_at", "sprints"."ends_on", "sprints"."finished_at") = 3
      end)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_sprint_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "sprint_id" text;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_active_per_project" ON "sprints" USING btree ("project_id") WHERE "sprints"."state" = 'active';--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_sprint_id_index" ON "tickets" USING btree ("sprint_id");