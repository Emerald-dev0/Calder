import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSign } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import {
  classifySesEvent,
  isAllowedSigningCertUrl,
  parseSnsEnvelope,
  parseSesMessage,
  setSnsCertFetcher,
  snsStringToSign,
  verifySnsSignature,
  SesEventError,
  type SesMessage,
  type SnsEnvelope,
} from "./ses-events.js";

/* ------------------------------------------------------------------ */
/*  isAllowedSigningCertUrl — host allowlist (SECURITY §6)             */
/* ------------------------------------------------------------------ */

describe("isAllowedSigningCertUrl", () => {
  const accepts = [
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-a9c5cc57dcb07f82735bcb6a28c30d8b.pem",
    "https://sns.eu-west-1.amazonaws.com/cert.pem",
    "https://sns.us-gov-east-1.amazonaws.com/cert.pem",
    "https://sns.cn-north-1.amazonaws.com/cert.pem",
  ];
  const rejects = [
    "https://sns.amazonaws.com/cert.pem", // need a region
    "https://amazonaws.com/",
    "http://sns.us-east-1.amazonaws.com/cert.pem", // not https
    "https://sns.us-east-1.amazonaws.com.evil.example/cert.pem", // subdomain attack
    "https://sns.us-east-1.evilexample.com/cert.pem",
    "https://192.0.2.10/cert.pem",
    "https://sns.us-east-1.amazonaws.com@evil.example/cert.pem", // userinfo trick
    "ftp://sns.us-east-1.amazonaws.com/cert.pem",
    "not a url",
    "",
  ];
  it.each(accepts)("accepts %s", (url) => {
    expect(isAllowedSigningCertUrl(url)).toBe(true);
  });
  it.each(rejects)("rejects %s", (url) => {
    expect(isAllowedSigningCertUrl(url)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  snsStringToSign — canonical field order                            */
/* ------------------------------------------------------------------ */

describe("snsStringToSign", () => {
  const base: SnsEnvelope = {
    Type: "Notification",
    MessageId: "m1",
    TopicArn: "arn:aws:sns:us-east-1:123:topic",
    Message: "{}",
    Timestamp: "2026-01-01T00:00:00.000Z",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/x.pem",
    SignatureVersion: "1",
    Signature: "sig",
  };
  it("Notification without Subject omits it", () => {
    expect(snsStringToSign(base)).toBe(
      "Message\n{}\nMessageId\nm1\nTimestamp\n2026-01-01T00:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123:topic\nType\nNotification\n"
    );
  });
  it("Notification with Subject inserts it before Timestamp", () => {
    expect(snsStringToSign({ ...base, Subject: "Amazon S3 Notification" })).toBe(
      "Message\n{}\nMessageId\nm1\nSubject\nAmazon S3 Notification\nTimestamp\n2026-01-01T00:00:00.000Z\nTopicArn\narn:aws:sns:us-east-1:123:topic\nType\nNotification\n"
    );
  });
  it("SubscriptionConfirmation uses the subscription field order", () => {
    const sub: SnsEnvelope = {
      ...base,
      Type: "SubscriptionConfirmation",
      Message: "sub-message",
      Token: "2336412f-37f8",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
    };
    expect(snsStringToSign(sub)).toBe(
      "Message\nsub-message\nMessageId\nm1\nSubscribeURL\nhttps://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription\nTimestamp\n2026-01-01T00:00:00.000Z\nToken\n2336412f-37f8\nTopicArn\narn:aws:sns:us-east-1:123:topic\nType\nSubscriptionConfirmation\n"
    );
    expect(snsStringToSign(sub)).not.toContain("Subject");
  });
});

/* ------------------------------------------------------------------ */
/*  parseSnsEnvelope validation                                        */
/* ------------------------------------------------------------------ */

describe("parseSnsEnvelope", () => {
  it("rejects non-JSON and wrong envelopes with 400", () => {
    expect(() => parseSnsEnvelope("not json")).toThrow(SesEventError);
    expect(() => parseSnsEnvelope("{}")).toThrow(/Missing SNS fields/);
    expect(() =>
      parseSnsEnvelope(
        JSON.stringify({
          Type: "Other",
          MessageId: "x",
          TopicArn: "arn:aws:sns:us-east-1:1:t",
          Message: "{}",
          Timestamp: "2026-01-01T00:00:00.000Z",
          SigningCertURL: "https://sns.us-east-1.amazonaws.com/x.pem",
          SignatureVersion: "1",
          Signature: "y",
        })
      )
    ).toThrow(/Unsupported SNS Type/);
  });
});

/* ------------------------------------------------------------------ */
/*  parseSesMessage                                                    */
/* ------------------------------------------------------------------ */

const envOf = (message: unknown): SnsEnvelope => ({
  Type: "Notification",
  MessageId: "m1",
  TopicArn: "arn:aws:sns:us-east-1:123:topic",
  Message: JSON.stringify(message),
  Timestamp: "2026-01-01T00:00:00.000Z",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/x.pem",
  SignatureVersion: "1",
  Signature: "sig",
});

describe("parseSesMessage", () => {
  it("parses eventType messages", () => {
    const m = parseSesMessage(
      envOf({ mail: { messageId: "abc" }, eventType: "bounce", bounce: {} })
    );
    expect(m.eventType).toBe("bounce");
    expect(m.mail.messageId).toBe("abc");
  });
  it("falls back to notificationType (legacy)", () => {
    const m = parseSesMessage(
      envOf({ mail: { messageId: "abc" }, notificationType: "Complaint", complaint: {} })
    );
    expect(m.eventType).toBe("complaint");
  });
  it("rejects messages without a mail.messageId", () => {
    expect(() => parseSesMessage(envOf({ eventType: "bounce", bounce: {} }))).toThrow(
      SesEventError
    );
  });
});

/* ------------------------------------------------------------------ */
/*  verifySnsSignature — accept genuine, reject forged                 */
/* ------------------------------------------------------------------ */

/** Generate a throwaway self-signed cert+key pair (test material only). */
function makeFixtureCert(): { certPem: string; keyPem: string } | null {
  const dir = join(tmpdir(), `sns-fixture-${process.pid}`);
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(cert)) {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-nodes",
          "-subj",
          "/CN=sns.test.local",
        ],
        { stdio: "ignore" }
      );
    }
    return { certPem: readFileSync(cert, "utf8"), keyPem: readFileSync(key, "utf8") };
  } catch {
    return null; // openssl unavailable — skip signature tests
  }
}

const fixture = makeFixtureCert();
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";

function sign(env: SnsEnvelope, keyPem: string): SnsEnvelope {
  const signer = createSign("RSA-SHA1");
  signer.update(snsStringToSign(env), "utf8");
  return { ...env, Signature: signer.sign(keyPem, "base64") };
}

function envelope(over: Partial<SnsEnvelope> = {}): SnsEnvelope {
  return {
    Type: "Notification",
    MessageId: "msg-1",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:ses-delivery",
    Message: JSON.stringify({
      mail: { messageId: "ses-abc" },
      eventType: "delivery",
      delivery: {},
    }),
    Timestamp: "2026-09-19T00:00:00.000Z",
    SigningCertURL: CERT_URL,
    SignatureVersion: "1",
    Signature: "PLACEHOLDER",
    ...over,
  };
}

const sigGate = fixture ? describe : describe.skip;
sigGate("verifySnsSignature (throwaway self-signed fixture)", () => {
  afterAll(() => setSnsCertFetcher(undefined));
  const fetchCert = async () => fixture!.certPem;

  it("accepts a correctly signed genuine envelope", async () => {
    setSnsCertFetcher(fetchCert);
    await expect(verifySnsSignature(sign(envelope(), fixture!.keyPem))).resolves.toBeUndefined();
  });

  it("rejects a tampered payload", async () => {
    setSnsCertFetcher(fetchCert);
    const signed = sign(envelope(), fixture!.keyPem);
    const tampered = {
      ...signed,
      Message: JSON.stringify({
        mail: { messageId: "ses-abc" },
        eventType: "complaint",
        complaint: {},
      }),
    };
    await expect(verifySnsSignature(tampered)).rejects.toThrow(/signature verification failed/);
  });

  it("rejects garbage signatures", async () => {
    setSnsCertFetcher(fetchCert);
    await expect(verifySnsSignature(envelope({ Signature: "AAAA" }))).rejects.toThrow();
  });

  it("rejects unsupported SignatureVersion", async () => {
    setSnsCertFetcher(fetchCert);
    await expect(
      verifySnsSignature(sign(envelope({ SignatureVersion: "2" }), fixture!.keyPem))
    ).rejects.toThrow(/Unsupported SNS SignatureVersion/);
  });

  it("rejects a hostile cert URL WITHOUT fetching it", async () => {
    let fetched = false;
    setSnsCertFetcher(async () => {
      fetched = true;
      return fixture!.certPem;
    });
    const evil = sign(
      envelope({ SigningCertURL: "https://sns.us-east-1.amazonaws.com.evil.example/x.pem" }),
      fixture!.keyPem
    );
    await expect(verifySnsSignature(evil)).rejects.toThrow(/not an official SNS endpoint/);
    expect(fetched).toBe(false);
  });

  it("signs the exact canonical string SNS signs (order matters)", async () => {
    setSnsCertFetcher(fetchCert);
    // A signature over a wrong canonicalization must fail.
    const env = envelope({ Subject: "x" });
    const wrong = createSign("RSA-SHA1");
    wrong.update(env.Message + env.MessageId, "utf8");
    await expect(
      verifySnsSignature({ ...env, Signature: wrong.sign(fixture!.keyPem, "base64") })
    ).rejects.toThrow(/signature verification failed/);
  });
});

/* ------------------------------------------------------------------ */
/*  classifySesEvent — full transition matrix (pure)                   */
/* ------------------------------------------------------------------ */

const msg = (eventType: string, over: Partial<SesMessage> = {}): SesMessage => ({
  eventType,
  mail: { messageId: "ses-msg" },
  ...over,
});

describe("classifySesEvent transition matrix", () => {
  // [name, currentStatus, event, wantStatus, wantEvent, wantSuppression]
  const cases: Array<
    [string, string, SesMessage, string | null, string | null, "bounce" | "complaint" | null]
  > = [
    [
      "delivery advances queued → delivered",
      "queued",
      msg("delivery"),
      "delivered",
      "delivered",
      null,
    ],
    ["delivery advances sent → delivered", "sent", msg("delivery"), "delivered", "delivered", null],
    ["delivery never regresses delivered", "delivered", msg("delivery"), null, "delivered", null],
    [
      "delivery does not override bounced (sticky)",
      "bounced",
      msg("delivery"),
      null,
      "delivered",
      null,
    ],
    ["open is event-only, never changes status", "delivered", msg("open"), null, "opened", null],
    ["click is event-only, never changes status", "delivered", msg("click"), null, "clicked", null],
    ["open event still recorded on failed row", "failed", msg("open"), null, "opened", null],
    [
      "permanent bounce bounces + suppresses",
      "sent",
      msg("bounce", { bounce: { bounceType: "Permanent" } }),
      "bounced",
      "bounced",
      "bounce",
    ],
    [
      "permanent bounce bounces a delivered row too",
      "delivered",
      msg("bounce", { bounce: { bounceType: "Permanent" } }),
      "bounced",
      "bounced",
      "bounce",
    ],
    [
      "permanent bounce keeps suppressed status, still suppresses",
      "suppressed",
      msg("bounce", { bounce: { bounceType: "Permanent" } }),
      null,
      "bounced",
      "bounce",
    ],
    [
      "transient bounce: event only, no status change, NO suppression",
      "sent",
      msg("bounce", { bounce: { bounceType: "Transient" } }),
      null,
      "bounced",
      null,
    ],
    [
      "transient bounce never suppresses (greylisting protection)",
      "queued",
      msg("bounce", { bounce: { bounceType: "Undetermined" } }),
      null,
      "bounced",
      null,
    ],
    [
      "complaint complains + suppresses",
      "delivered",
      msg("complaint"),
      "complained",
      "complained",
      "complaint",
    ],
    [
      "complaint keeps suppressed status, still suppresses",
      "suppressed",
      msg("complaint"),
      null,
      "complained",
      "complaint",
    ],
    ["reject fails the email", "queued", msg("reject"), "failed", "failed", null],
    [
      "rendering failure fails the email",
      "queued",
      msg("rendering failure"),
      "failed",
      "failed",
      null,
    ],
    [
      "reject cannot un-fail a bounced row (sticky)",
      "bounced",
      msg("reject"),
      null,
      "failed",
      null,
    ],
    ["send event: we already recorded it, do nothing", "sent", msg("send"), null, null, null],
    ["unknown event type ignored", "sent", msg("deliveryreceipt"), null, null, null],
  ];
  it.each(cases)("%s", (_name, current, m, wantStatus, wantEvent, wantSuppression) => {
    const got = classifySesEvent(current, m);
    expect(got.status).toBe(wantStatus);
    expect(got.eventType).toBe(wantEvent);
    expect(got.suppression).toBe(wantSuppression);
  });
});
