CREATE TYPE "public"."conversation_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE TYPE "public"."inbox_member_role" AS ENUM('viewer', 'member', 'manager');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."webhook_event" ADD VALUE 'inbound.received';--> statement-breakpoint
CREATE TABLE "inbox_conversation_labels" (
	"conversation_id" text NOT NULL,
	"label_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_conversation_labels_conversation_id_label_id_pk" PRIMARY KEY("conversation_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"inbox_id" text NOT NULL,
	"subject" text,
	"thread_key" varchar(64) NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"assignee_user_id" text,
	"first_message_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"inbound_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(60) NOT NULL,
	"color" varchar(24) DEFAULT 'neutral' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_members" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "inbox_member_role" DEFAULT 'member' NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"email_id" text NOT NULL,
	"sender_id" text,
	"author_user_id" text,
	"body_text" text,
	"body_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"receiving_domain_id" text NOT NULL,
	"local_part" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"default_sender_id" text,
	"status" "inbox_status" DEFAULT 'active' NOT NULL,
	"reply_to_address" varchar(255),
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "inbox_id" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "inbox_conversation_labels" ADD CONSTRAINT "inbox_conversation_labels_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation_labels" ADD CONSTRAINT "inbox_conversation_labels_label_id_inbox_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."inbox_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_labels" ADD CONSTRAINT "inbox_labels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_members" ADD CONSTRAINT "inbox_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_sender_id_sender_identities_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_replies" ADD CONSTRAINT "inbox_replies_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_routes" ADD CONSTRAINT "inbox_routes_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_routes" ADD CONSTRAINT "inbox_routes_receiving_domain_id_receiving_domains_id_fk" FOREIGN KEY ("receiving_domain_id") REFERENCES "public"."receiving_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_default_sender_id_sender_identities_id_fk" FOREIGN KEY ("default_sender_id") REFERENCES "public"."sender_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inboxes" ADD CONSTRAINT "inboxes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_conversations_inbox_last_idx" ON "inbox_conversations" USING btree ("inbox_id","last_message_at");--> statement-breakpoint
CREATE INDEX "inbox_conversations_project_last_idx" ON "inbox_conversations" USING btree ("project_id","last_message_at");--> statement-breakpoint
CREATE INDEX "inbox_conversations_thread_idx" ON "inbox_conversations" USING btree ("inbox_id","thread_key");--> statement-breakpoint
CREATE INDEX "inbox_conversations_assignee_idx" ON "inbox_conversations" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "inbox_conversations_open_idx" ON "inbox_conversations" USING btree ("inbox_id","last_message_at") WHERE status <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_labels_project_name_unique" ON "inbox_labels" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_members_inbox_user_unique" ON "inbox_members" USING btree ("inbox_id","user_id");--> statement-breakpoint
CREATE INDEX "inbox_members_user_idx" ON "inbox_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbox_notes_conversation_idx" ON "inbox_notes" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_replies_conversation_idx" ON "inbox_replies" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_replies_email_unique" ON "inbox_replies" USING btree ("email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_routes_domain_local_unique" ON "inbox_routes" USING btree ("receiving_domain_id","local_part");--> statement-breakpoint
CREATE INDEX "inbox_routes_inbox_idx" ON "inbox_routes" USING btree ("inbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inboxes_project_slug_unique" ON "inboxes" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "inboxes_project_idx" ON "inboxes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "inboxes_org_idx" ON "inboxes" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_inbox_received_idx" ON "inbound_messages" USING btree ("inbox_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_conversation_idx" ON "inbound_messages" USING btree ("conversation_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_message_id_idx" ON "inbound_messages" USING btree ("project_id","message_id_header");