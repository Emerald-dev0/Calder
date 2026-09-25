CREATE TABLE "marketing_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "email" varchar(320) NOT NULL,
  "first_name" varchar(255), "last_name" varchar(255),
  "consent_status" varchar(32) DEFAULT 'unknown' NOT NULL,
  "consent_source" varchar(255), "consented_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_project_email_unique" ON "marketing_contacts" USING btree ("project_id", "email");
CREATE INDEX "marketing_contacts_project_idx" ON "marketing_contacts" USING btree ("project_id");
CREATE INDEX "marketing_contacts_consent_idx" ON "marketing_contacts" USING btree ("project_id", "consent_status");
--> statement-breakpoint
CREATE TABLE "marketing_lists" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL, "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_lists_project_name_unique" ON "marketing_lists" USING btree ("project_id", "name");
--> statement-breakpoint
CREATE TABLE "marketing_list_members" (
  "list_id" text NOT NULL REFERENCES "marketing_lists"("id") ON DELETE CASCADE,
  "contact_id" text NOT NULL REFERENCES "marketing_contacts"("id") ON DELETE CASCADE,
  "subscribed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_list_members_unique" ON "marketing_list_members" USING btree ("list_id", "contact_id");
CREATE INDEX "marketing_list_members_contact_idx" ON "marketing_list_members" USING btree ("contact_id");
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL, "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "from" varchar(320) NOT NULL, "subject" varchar(998) NOT NULL,
  "html" text, "text" text, "list_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "scheduled_at" timestamp with time zone, "sent_at" timestamp with time zone,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "marketing_campaigns_project_status_idx" ON "marketing_campaigns" USING btree ("project_id", "status");
CREATE INDEX "marketing_campaigns_scheduled_idx" ON "marketing_campaigns" USING btree ("status", "scheduled_at");
