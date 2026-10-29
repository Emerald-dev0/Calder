export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;
export function canManageIncidents(role: string): boolean {
  return ["founder", "platform_admin", "infrastructure"].includes(role);
}
/** Notes may keep state unchanged. Resolved incidents are immutable; open a new one for recurrence. */
export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === "resolved") return false;
  if (from === to) return true;
  return (
    (
      {
        investigating: ["identified", "resolved"],
        identified: ["investigating", "monitoring", "resolved"],
        monitoring: ["identified", "resolved"],
      } as Record<string, string[]>
    )[from]?.includes(to) ?? false
  );
}
