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
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
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
