CREATE TABLE "waitlist_confirmation" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
