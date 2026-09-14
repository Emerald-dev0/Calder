import { sendInternalEmail } from "../services/email-service.js";

async function main() {
  console.log("Sending test email...");
  try {
    const result = await sendInternalEmail({
      to: "oluwadareanuoluwapo458@gmail.com",
      subject: "Test Send from Calder Agent",
      html: "<p>Hello, this is a test email from the Calder IDE agent.</p>",
      text: "Hello, this is a test email from the Calder IDE agent.",
      idempotencyKey: `test-${Date.now()}`,
      requestId: `req-${Date.now()}`,
    });
    console.log("Email enqueued successfully:", result);
    process.exit(0);
  } catch (err) {
    console.error("Failed to send email:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
