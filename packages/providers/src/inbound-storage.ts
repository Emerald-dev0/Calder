import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@calder/config";

/**
 * Raw message storage for inbound email.
 *
 * The interface exists for one reason: the ingest pipeline must be testable
 * without an AWS account, and there must be exactly one place that knows how
 * bytes get to S3. There is no in-memory implementation used in production —
 * an unconfigured store throws, so a deploy that forgot `INBOUND_BUCKET` fails
 * loudly instead of appearing to accept mail into nowhere.
 */
export interface RawMessageStore {
  /** Storage key for a message's raw MIME, given its ids. Stable across retries. */
  rawKey(input: { projectId: string; messageId: string }): string;
  /** Storage key for one attachment part of a message. */
  attachmentKey(input: { projectId: string; messageId: string; partIndex: number }): string;
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export class InboundStorageNotConfigured extends Error {
  readonly code = "inbound_storage_not_configured";
  constructor(message: string) {
    super(message);
    this.name = "InboundStorageNotConfigured";
  }
}

export class InboundObjectNotFound extends Error {
  readonly code = "inbound_object_not_found";
  constructor(key: string) {
    super(`Inbound object not found: ${key}`);
    this.name = "InboundObjectNotFound";
  }
}

let cached: S3RawMessageStore | null = null;

export class S3RawMessageStore implements RawMessageStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string
  ) {}

  private key(...parts: string[]): string {
    const clean = this.prefix.replace(/^\/+|\/+$/g, "");
    return `${clean}/${parts.join("/")}`;
  }

  rawKey(input: { projectId: string; messageId: string }): string {
    // Date-free on purpose: the key must be derivable from ids alone so a
    // retry after a failed insert writes to the same place.
    return this.key(input.projectId, input.messageId, "raw.eml");
  }

  attachmentKey(input: { projectId: string; messageId: string; partIndex: number }): string {
    return this.key(input.projectId, input.messageId, `attachments/${input.partIndex}`);
  }

  async put(key: string, body: Uint8Array, contentType = "message/rfc822"): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Server-side encryption is a bucket default in our setup; asking for
        // it here too means a misconfigured bucket still stores ciphertext.
        ServerSideEncryption: "AES256",
      })
    );
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new InboundObjectNotFound(key);
      return await res.Body.transformToByteArray();
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") throw new InboundObjectNotFound(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * The configured store, or a throw.
 *
 * A caller that needs storage and gets an exception here is being told the
 * truth: this deployment cannot receive mail yet.
 */
export function getRawMessageStore(env: NodeJS.ProcessEnv = process.env): RawMessageStore {
  if (cached) return cached;
  const cfg = getConfig();
  if (!cfg.INBOUND_BUCKET) {
    throw new InboundStorageNotConfigured(
      "INBOUND_BUCKET is not set, so received mail cannot be stored. Configure the bucket and SNS topic before enabling inbound."
    );
  }
  if (!env.AWS_ACCESS_KEY_ID && !env.AWS_ROLE_ARN && !env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) {
    throw new InboundStorageNotConfigured(
      "No AWS credentials are visible to the API process, so raw mail cannot be stored."
    );
  }
  const client = new S3Client({
    region: cfg.AWS_REGION,
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  cached = new S3RawMessageStore(client, cfg.INBOUND_BUCKET, cfg.INBOUND_S3_PREFIX);
  return cached;
}

/** Test seam: the pipeline is exercised with an explicit store. */
export function setRawMessageStoreForTests(store: RawMessageStore | null): void {
  cached = store as S3RawMessageStore | null;
}
