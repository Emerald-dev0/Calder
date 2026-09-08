-- Project sending transports (graduation path: gmail -> domain -> managed infra)
--> statement-breakpoint
CREATE TYPE "public"."transport_type" AS ENUM('gmail', 'ses', 'managed');
--> statement-breakpoint
CREATE TYPE "public"."transport_status" AS ENUM('active', 'suspended', 'revoked');
--> statement-breakpoint
CREATE TABLE "project_transports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" "transport_type" NOT NULL,
	"status" "transport_status" DEFAULT 'active' NOT NULL,
	"label" varchar(320) NOT NULL,
	"encrypted_credentials" jsonb,
	"daily_cap" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_transports" ADD CONSTRAINT "project_transports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "transports_project_idx" ON "project_transports" USING btree ("project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "transports_project_type_label_unique" ON "project_transports" USING btree ("project_id","type","label");
