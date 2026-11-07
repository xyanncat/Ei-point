// AI module: persistent memory, provider routing with fallback, budgets
// (§2 ai bot, §4 ai.*). No local inference — external providers only (§1).
// Provider fns are injected; no vendor SDKs here.

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Bounded prompt window: recent messages capped by count and chars, plus summary.
export function buildPromptWindow(
  messages: ChatMessage[],
  summary: string | null,
  maxMessages = 20,
  maxChars = 8000,
): ChatMessage[] {
  const window: ChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && window.length < maxMessages; i--) {
    const m = messages[i]!;
    if (chars + m.content.length > maxChars) break;
    chars += m.content.length;
    window.unshift(m);
  }
  if (summary != null && summary !== "") {
    return [{ role: "system", content: `Conversation summary so far: ${summary}` }, ...window];
  }
  return window;
}

// --- Provider routing: primary -> fallback, 2 concurrent, 20 queued, 60 s deadline. ---
export const AI_CONCURRENT = 2;
export const AI_QUEUE_MAX = 20;
export const AI_DEADLINE_MS = 60_000;

export interface ProviderResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type ProviderFn = (prompt: ChatMessage[], signal: AbortSignal) => Promise<ProviderResult>;

export type ProviderFailure = "queue-full" | "all-failed" | "budget-exceeded";

export function createRouter(opts: {
  primary: ProviderFn;
  fallback: ProviderFn;
  deadlineMs?: number;
}): {
  ask: (prompt: ChatMessage[]) => Promise<{ ok: true; result: ProviderResult; via: "primary" | "fallback" } | { ok: false; reason: ProviderFailure }>;
  inFlight: () => number;
  queued: () => number;
} {
  const deadlineMs = opts.deadlineMs ?? AI_DEADLINE_MS;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > AI_DEADLINE_MS) throw new Error("Invalid AI deadline");
  let active = 0;
  type Waiting = { enqueuedAt: number; start: () => void };
  const waiting: Waiting[] = [];

  async function runWith(provider: ProviderFn, prompt: ChatMessage[], budgetMs: number): Promise<ProviderResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("deadline-exceeded")); }, budgetMs);
    });
    try {
      return await Promise.race([provider(prompt, controller.signal), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * The deadline is the CALLER's budget: queue wait counts, so a slot-holder
   * either runs within what is left or passes its slot on (redesign
   * infrastructure §6). The remainder is split evenly between the primary and
   * fallback attempts; an attempt that fails early leaves its leftover to the
   * other one, so the total never exceeds the stated deadline.
   */
  async function ask(prompt: ChatMessage[]) {
    if (active >= AI_CONCURRENT && waiting.length >= AI_QUEUE_MAX) {
      return { ok: false as const, reason: "queue-full" as const };
    }
    const enqueuedAt = Date.now();
    if (active >= AI_CONCURRENT) {
      await new Promise<void>((resolve) => waiting.push({ enqueuedAt, start: resolve }));
    }
    const remaining = deadlineMs - (Date.now() - enqueuedAt);
    if (remaining <= 0) {
      const next = waiting.shift();
      if (next != null) next.start();
      return { ok: false as const, reason: "all-failed" as const };
    }
    const firstBudget = Math.ceil(remaining / 2);
    active++;
    try {
      const firstStartedAt = Date.now();
      try {
        const result = await runWith(opts.primary, prompt, firstBudget);
        return { ok: true as const, result, via: "primary" as const };
      } catch {
        // The leftover is what the primary did not use. A 1ms floor keeps an
        // instant fallback usable even when the abort timer overshoots its
        // stated budget (Windows timer resolution); a slow fallback still gets
        // aborted at ~1ms, so the overshoot stays bounded.
        const fallbackBudget = Math.max(1, remaining - (Date.now() - firstStartedAt));
        const result = await runWith(opts.fallback, prompt, fallbackBudget);
        return { ok: true as const, result, via: "fallback" as const };
      }
    } catch {
      return { ok: false as const, reason: "all-failed" as const };
    } finally {
      active--;
      const next = waiting.shift();
      if (next != null) next.start();
    }
  }

  return { ask, inFlight: () => active, queued: () => waiting.length };
}

// --- Usage budgets: per guild+user caps per day (minor units as token counts). ---
export function budgetExceeded(usedToday: number, cap: number): boolean {
  return usedToday >= cap;
}

export const UPSERT_THREAD_SQL = `
  INSERT INTO ai.threads (guild_id, user_id, persona, updated_at)
  VALUES ($1, $2, $3, now())
  ON CONFLICT (guild_id, user_id, persona) DO UPDATE SET updated_at = now()
  RETURNING thread_id, summary`;

export const ADD_MESSAGE_SQL = `
  INSERT INTO ai.messages (thread_id, role, content, tokens)
  VALUES ($1, $2, $3, $4)`;

export const RECENT_MESSAGES_SQL = `
  SELECT role, content FROM ai.messages
  WHERE thread_id = $1 ORDER BY message_id DESC LIMIT $2`;

export const SAVE_SUMMARY_SQL = `
  UPDATE ai.threads SET summary = $2, updated_at = now() WHERE thread_id = $1`;

export const RECORD_USAGE_SQL = `
  INSERT INTO ai.usage_ledger (guild_id, user_id, provider, tokens_in, tokens_out)
  VALUES ($1, $2, $3, $4, $5)`;

export const USAGE_TODAY_SQL = `
  SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS used
  FROM ai.usage_ledger
  WHERE guild_id = $1 AND user_id = $2 AND created_at >= date_trunc('day', now())`;

// --- Per-provider cost units: characters for speech/translation (§6). -------
// `provider` values carry a capability prefix ("tts:…", "translate:…") so
// daily sums stay per capability without schema churn.
export const RECORD_UNITS_USAGE_SQL = `
  INSERT INTO ai.usage_ledger (guild_id, user_id, provider, units)
  VALUES ($1, $2, $3, $4)`;

export const USAGE_UNITS_TODAY_SQL = `
  SELECT COALESCE(SUM(units), 0) AS used
  FROM ai.usage_ledger
  WHERE guild_id = $1 AND user_id = $2 AND provider LIKE $3
    AND created_at >= date_trunc('day', now())`;

export const USAGE_UNITS_TODAY_GLOBAL_SQL = `
  SELECT COALESCE(SUM(units), 0) AS used
  FROM ai.usage_ledger
  WHERE provider LIKE $1 AND created_at >= date_trunc('day', now())`;

export const PENDING_UNITS_SQL = `
  SELECT COALESCE(SUM(tokens), 0) AS reserved
  FROM ai.budget_reservations
  WHERE kind = $1 AND guild_id = $2 AND user_id = $3 AND expires_at > now()`;

/**
 * Impure admission math for unit budgets (pure for tests). Pending
 * reservations of the same kind count because they have not settled or
 * expired yet; other kinds keep separate caps.
 */
export function unitBudgetExceeded(
  usedUnits: number,
  pendingUnits: number,
  globalUsedUnits: number,
  reservedUnits: number,
  perUserDailyCap: number,
  globalDailyCap: number,
): boolean {
  if (usedUnits + pendingUnits + reservedUnits > perUserDailyCap) return true;
  return globalUsedUnits + reservedUnits > globalDailyCap;
}


/** OpenAI-compatible HTTP adapter. Configuration and all malformed/error responses fail closed. */
export function makeHttpProvider(apiUrl?: string, apiKey?: string, request: typeof fetch = fetch, model?: string): ProviderFn {
  return async (messages, signal) => {
    if (!apiUrl) throw new Error("provider-not-configured");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await request(apiUrl, {
      method: "POST", headers,
      body: JSON.stringify({ ...(model ? { model } : {}), messages, max_tokens: 1000 }), signal,
    });
    if (!response.ok) throw new Error(`provider-http-${response.status}`);
    const data = await response.json() as any;
    const text = data?.choices?.[0]?.message?.content;
    const tokensIn = data?.usage?.prompt_tokens;
    const tokensOut = data?.usage?.completion_tokens;
    if (typeof text !== "string" || !text.trim() || !Number.isSafeInteger(tokensIn) || tokensIn < 0 || !Number.isSafeInteger(tokensOut) || tokensOut < 0)
      throw new Error("invalid-provider-response");
    return { text, tokensIn, tokensOut };
  };
}

/** Bounded extractive memory, explicitly quoted data rather than additional instructions. */
export function summarizeConversation(previous: string | null, messages: ChatMessage[]): string {
  return [previous ?? "", ...messages.map(m => `${m.role}: ${m.content}`)].filter(Boolean).join("\n").slice(-2000);
}
