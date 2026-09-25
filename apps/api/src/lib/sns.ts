import { createVerify } from "node:crypto";

export type SnsEnvelope = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn?: string;
  Message: string;
  SubscribeURL?: string;
  SigningCertURL?: string;
  Signature: string;
  Subject?: string;
};

function canonical(envelope: SnsEnvelope): string {
  const fields = envelope.Type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return fields.filter((key) => key in envelope && (envelope as unknown as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${key}\n${(envelope as unknown as Record<string, string>)[key]}\n`)
    .join("");
}

export function validSnsUrl(value: string, topicArn?: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)) return false;
    if (topicArn) {
      const region = topicArn.split(":")[3];
      if (region && url.hostname !== `sns.${region}.amazonaws.com`) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function verifySnsSignature(envelope: SnsEnvelope): Promise<boolean> {
  if (!envelope.Signature || !envelope.SigningCertURL || !validSnsUrl(envelope.SigningCertURL, envelope.TopicArn) || !new URL(envelope.SigningCertURL).pathname.endsWith(".pem")) {
    return false;
  }
  const response = await fetch(envelope.SigningCertURL);
  if (!response.ok) return false;
  const certificate = await response.text();
  const verifier = createVerify("RSA-SHA1");
  verifier.update(canonical(envelope), "utf8");
  return verifier.verify(certificate, envelope.Signature, "base64");
}

export function parseSnsEnvelope(value: unknown): SnsEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(String(input.Type))) return null;
  for (const key of ["MessageId", "Message", "Signature", "SigningCertURL"]) {
    if (typeof input[key] !== "string" || !input[key]) return null;
  }
  return input as unknown as SnsEnvelope;
}
