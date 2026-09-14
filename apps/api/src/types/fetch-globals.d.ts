/**
 * Ambient guarantee for the fetch globals the codebase relies on.
 *
 * Consumers that bundle workspace sources (e.g. Vercel's serverless
 * TypeScript pass) may resolve the global `Response` from a narrower type
 * environment than our repo CI, where `lib: ["ES2022", "DOM"]` provides the
 * standard fetch types. This augmentation merges the members we actually
 * use (`packages/providers`, `packages/auth`, api middleware) into whatever
 * global `Response`/`Headers` the consuming environment provides. It is
 * additive-only: under a full DOM/undici environment it is a no-op.
 */
declare global {
  interface Response {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly url: string;
    json(): Promise<unknown>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
}

export {};
