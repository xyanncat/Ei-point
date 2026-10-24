import type { ErrorEnvelope, DashboardApiPaths } from "@ei-point/contracts";
export type AccountResponse =
  DashboardApiPaths["/api/auth/me"]["get"]["responses"][200]["content"]["application/json"];
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}
export type RolePreview = "user" | "admin" | null;

const PREVIEW_KEY = "ei-role-preview";

/** The segment under test. Only ever set for the master; the API admits the
 * override for the master identity alone and only downwards. */
export function getRolePreview(): Exclude<RolePreview, null> | null {
  try {
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PREVIEW_KEY)
        : null;
    return raw === "user" || raw === "admin" ? raw : null;
  } catch {
    return null;
  }
}

export function setRolePreview(next: RolePreview): void {
  try {
    if (typeof window === "undefined") return;
    if (next === null) window.localStorage.removeItem(PREVIEW_KEY);
    else window.localStorage.setItem(PREVIEW_KEY, next);
  } catch {
    /* storage blocked — preview simply does not persist */
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const preview = getRolePreview();
  const headers = new Headers(init.headers);
  if (preview && !headers.has("x-ei-preview-role"))
    headers.set("x-ei-preview-role", preview);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({}))) as Partial<ErrorEnvelope>;
    throw new ApiError(
      response.status,
      body.code ?? "request-failed",
      body.error ?? "This view could not be loaded. Please retry.",
      body.correlationId,
    );
  }
  return response.json() as Promise<T>;
}
