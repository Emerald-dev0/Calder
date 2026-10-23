"use server";

import { getTenantContext } from "../../../lib/auth";
import {
  createDomainSender as createDomainSenderSvc,
  createGmailSender as createGmailSenderSvc,
  dispatchStatus as dispatchStatusSvc,
  dispatchTestEmail as dispatchTestEmailSvc,
  getSender as getSenderSvc,
  listSenders as listSendersSvc,
  projectApiKeys as projectApiKeysSvc,
  retireSender as retireSenderSvc,
  senderAllowedKeyIds as senderAllowedKeyIdsSvc,
  senderCreationOptions as senderCreationOptionsSvc,
  senderHealth as senderHealthSvc,
  senderHealthFor as senderHealthForSvc,
  senderStreamStats as senderStreamStatsSvc,
  setSenderAllowedKeys as setSenderAllowedKeysSvc,
  setSenderDefault as setSenderDefaultSvc,
  setSenderEnabled as setSenderEnabledSvc,
  setSenderReplyTo as setSenderReplyToSvc,
  streamStats as streamStatsSvc,
  unarchiveSender as unarchiveSenderSvc,
  updateSenderDisplayName as updateSenderDisplayNameSvc,
  type DefaultKind,
  type DispatchStatus,
  type RetireResult,
  type SenderActor,
  type SenderHealth,
  type SenderRow,
  type StreamStats,
} from "../../../lib/senders/service";

/**
 * Server actions for the Senders pages.
 *
 * Each one resolves the actor from the session and hands straight to the
 * service in `lib/senders/service.ts`, which owns the tenant checks and the
 * rules. Nothing here re-implements a rule, so a rule cannot drift between the
 * page and the action that backs it.
 */

/** Actor, plus a membership assertion for the project-scoped read actions. */
async function actorForProject(projectId: string): Promise<SenderActor> {
  const a = await actor();
  if (!a.projectIds.includes(projectId)) throw new Error("Project not found.");
  return a;
}

async function actor(): Promise<SenderActor> {
  const ctx = await getTenantContext();
  const projectIds = [...new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)))];
  return { userId: ctx.user.userId, projectIds };
}

export async function listSenders(
  projectId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<SenderRow[]> {
  return listSendersSvc(await actor(), projectId, opts);
}

export async function getSender(senderId: string): Promise<SenderRow> {
  return getSenderSvc(await actor(), senderId);
}

export async function senderHealth(projectId: string): Promise<Record<string, SenderHealth>> {
  await actorForProject(projectId);
  const map = await senderHealthSvc(projectId);
  return Object.fromEntries(map);
}

export async function streamStats(projectId: string): Promise<StreamStats> {
  await actorForProject(projectId);
  return streamStatsSvc(projectId);
}

export async function senderHealthFor(senderId: string): Promise<SenderHealth> {
  return senderHealthForSvc(await actor(), senderId);
}

export async function senderStreamStats(senderId: string): Promise<StreamStats> {
  return senderStreamStatsSvc(await actor(), senderId);
}

export async function createDomainSender(input: {
  projectId: string;
  displayName: string;
  localPart: string;
  domain: string;
}): Promise<{ id: string }> {
  return createDomainSenderSvc(await actor(), input);
}

export async function createGmailSender(input: {
  projectId: string;
  transportId: string;
  displayName: string;
}): Promise<{ id: string }> {
  return createGmailSenderSvc(await actor(), input);
}

export async function setSenderDefault(
  senderId: string,
  kind: DefaultKind,
  value: boolean
): Promise<{ ok: true }> {
  return setSenderDefaultSvc(await actor(), senderId, kind, value);
}

/** Kept for existing callers: sets the transactional default. */
export async function setDefaultSender(senderId: string): Promise<{ ok: true }> {
  return setSenderDefaultSvc(await actor(), senderId, "transactional", true);
}

export async function updateSenderDisplayName(
  senderId: string,
  displayName: string
): Promise<{ ok: true }> {
  return updateSenderDisplayNameSvc(await actor(), senderId, displayName);
}

export async function setSenderReplyTo(
  senderId: string,
  replyTo: string | null
): Promise<{ ok: true; replyTo: string | null }> {
  return setSenderReplyToSvc(await actor(), senderId, replyTo);
}

export async function setSenderEnabled(senderId: string, enabled: boolean): Promise<{ ok: true }> {
  return setSenderEnabledSvc(await actor(), senderId, enabled);
}

export async function deleteSender(senderId: string): Promise<RetireResult> {
  return retireSenderSvc(await actor(), senderId);
}

export async function unarchiveSender(senderId: string): Promise<{ ok: true }> {
  return unarchiveSenderSvc(await actor(), senderId);
}

export async function senderAllowedKeyIds(senderId: string): Promise<string[]> {
  return senderAllowedKeyIdsSvc(await actor(), senderId);
}

export async function projectApiKeys(projectId: string) {
  return projectApiKeysSvc(await actor(), projectId);
}

export async function setSenderAllowedKeys(
  senderId: string,
  keyIds: string[]
): Promise<{ ok: true; restricted: boolean }> {
  return setSenderAllowedKeysSvc(await actor(), senderId, keyIds);
}

export async function testSend(
  senderId: string,
  to: string
): Promise<{ ok: true; emailId: string }> {
  const result = await dispatchTestEmailSvc(await actor(), senderId, to);
  return { ok: true, emailId: result.emailId };
}

export async function testSendStatus(
  projectId: string,
  emailId: string
): Promise<DispatchStatus | null> {
  return dispatchStatusSvc(await actor(), projectId, emailId);
}

export async function senderCreationOptions(projectId: string) {
  return senderCreationOptionsSvc(await actor(), projectId);
}
