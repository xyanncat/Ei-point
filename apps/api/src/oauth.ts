// Discord OAuth (§6): authorize-URL builder + state validation + code exchange.
// The token exchange takes an injectable fetcher so tests never touch the network.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZE_BASE = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  stateSecret: string;
}

export function buildAuthorizeUrl(
  cfg: OAuthConfig,
  scopes = ["identify", "guilds", "guilds.members.read"],
): { url: string; state: string } {
  const nonce = randomBytes(16).toString("base64url");
  const data = `${Date.now()}.${nonce}`;
  const mac = createHmac("sha256", cfg.stateSecret)
    .update(data)
    .digest("base64url");
  const state = `${data}.${mac}`;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUrl,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  });
  return { url: `${AUTHORIZE_BASE}?${params.toString()}`, state };
}

export function verifyOAuthState(state: string, secret: string): boolean {
  const [stamp, nonce, mac, extra] = state.split(".");
  if (
    !secret ||
    stamp == null ||
    nonce == null ||
    mac == null ||
    extra !== undefined ||
    !/^\d{13}$/.test(stamp) ||
    !/^[\w-]{22}$/.test(nonce) ||
    !/^[\w-]{43}$/.test(mac)
  )
    return false;
  const age = Date.now() - Number(stamp);
  if (age < -5000 || age > 300000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${stamp}.${nonce}`)
    .digest();
  const actual = Buffer.from(mac, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export async function exchangeCode(
  cfg: OAuthConfig,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUrl,
  });
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`oauth-exchange-failed:${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };
  if (
    typeof data.access_token !== "string" ||
    data.token_type !== "Bearer" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new Error("oauth-exchange-bad-payload");
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
  };
}
