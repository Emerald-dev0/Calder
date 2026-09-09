export interface ApiKeyContext {
 type: "api_key";
 apiKeyId: string;
 projectId: string;
 organizationId: string;
 env: "test" | "live";
 keyPrefix: string;
}

export interface SessionContext {
 type: "session";
 userId: string;
 email: string;
 organizationId?: string;
}

export type AuthContext = ApiKeyContext | SessionContext;
