export type ReportingEnvironment = "live" | "test" | "all";
/** Invalid or missing URL state must never silently mix simulations into live reports. */
export function reportingEnvironment(value: unknown): ReportingEnvironment {
  return value === "test" || value === "all" ? value : "live";
}
