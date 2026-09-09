import type { MiddlewareHandler } from "hono";
import { generateRequestId } from "@calder/observability";

export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
 const incoming = c.req.header("x-request-id");
 const requestId = incoming && incoming.length <= 64 ? incoming : generateRequestId();
 c.set("requestId", requestId);
 c.header("X-Request-Id", requestId);
 await next();
};
