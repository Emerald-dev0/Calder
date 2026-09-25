# @calder/sdk

Official TypeScript/Node.js client for Calder. It uses the platform `fetch` implementation, supports `AbortSignal`, surfaces request IDs and preserves idempotency keys for safe retries.

```ts
import { Calder } from "@calder/sdk";
const calder = new Calder(process.env.CALDER_API_KEY!);
await calder.emails.send({ from: "hello@example.com", to: "you@example.com", subject: "Hello", text: "Sent through Calder" }, { idempotencyKey: "welcome-1" });
```

Run `pnpm build` before publishing. The package ships only `dist` and documentation; workspace internals are never included.
