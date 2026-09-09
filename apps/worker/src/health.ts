import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export function createHealthServer() {
 return createServer((req: IncomingMessage, res: ServerResponse) => {
 if (req.url === "/health") {
 res.writeHead(200, { "Content-Type": "application/json" });
 res.end(
 JSON.stringify({ status: "ok", service: "worker", timestamp: new Date().toISOString() })
 );
 return;
 }
 if (req.url === "/ready") {
 res.writeHead(200, { "Content-Type": "application/json" });
 res.end(JSON.stringify({ status: "ready", timestamp: new Date().toISOString() }));
 return;
 }
 res.writeHead(404, { "Content-Type": "application/json" });
 res.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
 });
}
