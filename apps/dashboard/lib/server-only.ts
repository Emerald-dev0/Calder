/**
 * Zero-dep server guard (the `server-only` npm package's one job without a
 * new dependency): control-plane data access modules import this — if any of
 * them are ever pulled into a client bundle, the module throws at load time.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "A server-only module (control queries / auth context) was imported into a client bundle. Import it from server components or actions only."
  );
}
export {};
