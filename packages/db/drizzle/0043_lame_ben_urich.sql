CREATE TABLE "inbox_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_reads" ADD CONSTRAINT "inbox_reads_conversation_id_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_reads" ADD CONSTRAINT "inbox_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_reads_conversation_user_unique" ON "inbox_reads" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "inbox_reads_user_idx" ON "inbox_reads" USING btree ("user_id");