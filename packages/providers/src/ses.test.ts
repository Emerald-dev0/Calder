import { describe, expect, it, afterEach } from "vitest";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SesEmailProvider } from "./ses";

/** Fake client: records every command input, returns a canned MessageId. */
function fakeClient() {
  const sent: SendEmailCommand["input"][] = [];
  const client = {
    send: async (cmd: SendEmailCommand) => {
      sent.push(cmd.input);
      return { MessageId: "ses-test-123", $metadata: {} };
    },
  } as unknown as SESv2Client;
  return { client: client as SESv2Client, sent };
}

const message = {
  from: "hello@calder.click",
  to: "x@example.test",
  subject: "hi",
  text: "hello",
};

describe("SesProvider", () => {
  afterEach(() => {
    delete process.env.SES_CONFIGURATION_SET;
  });

  it("providerMessageId from SES is returned", async () => {
    const { client } = fakeClient();
    const res = await new SesEmailProvider(client).send(message);
    expect(res.accepted).toBe(true);
    expect(res.providerMessageId).toBe("ses-test-123");
    expect(res.provider).toBe("ses");
  });

  it("sets ConfigurationSetName when SES_CONFIGURATION_SET is set (delivery-truth wiring)", async () => {
    process.env.SES_CONFIGURATION_SET = "calder-default";
    const { client, sent } = fakeClient();
    await new SesEmailProvider(client).send(message);
    expect(sent[0]?.ConfigurationSetName).toBe("calder-default");
  });

  it("omits ConfigurationSetName when the env var is unset", async () => {
    const { client, sent } = fakeClient();
    await new SesEmailProvider(client).send(message);
    expect(sent[0]?.ConfigurationSetName).toBeUndefined();
  });

  it("classifies throttling as transient, validation errors as permanent", async () => {
    const failing = (name: string) =>
      ({
        send: async () => {
          const e = new Error("boom") as Error & { name: string };
          e.name = name;
          throw e;
        },
      }) as unknown as SESv2Client;

    await expect(
      new SesEmailProvider(failing("ThrottlingException")).send(message)
    ).rejects.toMatchObject({ transient: true });
    await expect(
      new SesEmailProvider(failing("MessageRejected")).send(message)
    ).rejects.toMatchObject({ transient: false, statusCode: 400 });
  });
});
