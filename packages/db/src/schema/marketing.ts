import { pgTable, text, varchar, timestamp, boolean, jsonb, index, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

export const marketingContacts = pgTable("marketing_contacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  consentStatus: varchar("consent_status", { length: 32 }).notNull().default("unknown"),
  consentSource: varchar("consent_source", { length: 255 }),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("marketing_contacts_project_email_unique").on(t.projectId, t.email), index("marketing_contacts_project_idx").on(t.projectId), index("marketing_contacts_consent_idx").on(t.projectId, t.consentStatus)]);

export const marketingLists = pgTable("marketing_lists", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("marketing_lists_project_name_unique").on(t.projectId, t.name)]);

export const marketingListMembers = pgTable("marketing_list_members", {
  listId: text("list_id").notNull().references(() => marketingLists.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => marketingContacts.id, { onDelete: "cascade" }),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("marketing_list_members_unique").on(t.listId, t.contactId), index("marketing_list_members_contact_idx").on(t.contactId)]);

export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  from: varchar("from", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 998 }).notNull(),
  html: text("html"),
  text: text("text"),
  listIds: jsonb("list_ids").$type<string[]>().notNull().default([]),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("marketing_campaigns_project_status_idx").on(t.projectId, t.status), index("marketing_campaigns_scheduled_idx").on(t.status, t.scheduledAt)]);

export type MarketingContact = typeof marketingContacts.$inferSelect;
export type MarketingList = typeof marketingLists.$inferSelect;
export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
