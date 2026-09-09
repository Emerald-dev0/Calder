import { describe, it, expect } from "vitest";
import { InMemoryQueue } from "./queue";

describe("InMemoryQueue", () => {
 it("enqueues and processes jobs", async () => {
 const q = new InMemoryQueue<string>("test", { maxAttempts: 2 });
 const processed: string[] = [];
 q.process(async (job) => {
 processed.push(job.data);
 });
 await q.enqueue("greet", "hello");
 await q.drain?.();
 expect(processed).toEqual(["hello"]);
 });

 it("retries transient failures", async () => {
 const q = new InMemoryQueue<{ id: string }>("retry-test", { maxAttempts: 3 });
 let attempts = 0;
 q.process(async (job) => {
 attempts++;
 if (attempts < 3) throw new Error("transient");
 });
 await q.enqueue("fail", { id: "1" });
 await q.drain?.();
 expect(attempts).toBeGreaterThanOrEqual(2);
 });
});
