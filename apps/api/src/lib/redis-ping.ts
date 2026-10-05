/**
 * Redis connectivity probe.
 *
 * Implementation moved to `@calder/queue` in Phase 2 so the worker and the API
 * share exactly one probe (and one definition of "reachable"). Kept as a
 * re-export because this path is imported across the API.
 */
export { pingRedis, pingRedisUrl } from "@calder/queue";
