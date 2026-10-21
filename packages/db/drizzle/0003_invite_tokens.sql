ALTER TABLE "invites" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tokenHash_unique" UNIQUE("token_hash");