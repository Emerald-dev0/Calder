/**
 * Tenant scoping helpers, ensure every query is project/organization scoped.
 * Use these at the data-access layer, not just middleware.
 */

export function scopedWhere<T extends { projectId: string }>(
 projectId: string
): { projectId: string } {
 return { projectId };
}

export function assertTenantProject(resourceProjectId: string, contextProjectId: string): void {
 if (resourceProjectId !== contextProjectId) {
 const err = new Error("Tenant isolation violation: project mismatch") as Error & {
 status?: number;
 code?: string;
 };
 err.status = 403;
 err.code = "authorization_error";
 throw err;
 }
}
