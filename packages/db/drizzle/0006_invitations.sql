-- Organization invitations (email-first; accepted on signup/login match)
--> statement-breakpoint
CREATE TABLE "org_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"token_hash" varchar(255) NOT NULL UNIQUE,
	"invited_by" text,
	"accepted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "org_invitations" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "org_invitations" USING btree ("email");
