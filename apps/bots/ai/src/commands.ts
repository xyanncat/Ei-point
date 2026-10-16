import { randomUUID } from "node:crypto";
import { SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  buildPromptWindow,
  summarizeConversation,
  UPSERT_THREAD_SQL,
  ADD_MESSAGE_SQL,
  RECENT_MESSAGES_SQL,
  SAVE_SUMMARY_SQL,
  RECORD_USAGE_SQL,
  USAGE_TODAY_SQL,
  type ChatMessage,
  type ProviderResult,
} from "@ei-point/module-ai";

export interface AiCommandRequest {
  name: string;
  options: Record<string, string | number | boolean>;
  guildId: string;
  userId: string;
  key: string;
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
  askRouter(messages: ChatMessage[]): Promise<{
    ok: boolean;
    result?: ProviderResult;
    via?: "primary" | "fallback";
    reason?: string;
  }>;
  dailyBudgetCap: number;
  systemPrompt?: string;
}

export const aiCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Chat with the AI assistant")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("prompt").setDescription("Your question or message").setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName("persona")
        .setDescription("Assistant persona")
        .addChoices(
          { name: "Default (Ei)", value: "default" },
          { name: "Support & Docs", value: "support" },
          { name: "Anime Character", value: "anime" },
          { name: "Concise", value: "concise" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("persona")
    .setDescription("View or change your AI conversation persona")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Persona name")
        .addChoices(
          { name: "Default (Ei)", value: "default" },
          { name: "Support & Docs", value: "support" },
          { name: "Anime Character", value: "anime" },
          { name: "Concise", value: "concise" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset your conversation history and persistent bot memory")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("persona").setDescription("Specific persona to reset")),

  new SlashCommandBuilder()
    .setName("usage")
    .setDescription("Check your AI token usage today against daily limits")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("model")
    .setDescription("View AI provider configuration and router status")
    .setDMPermission(false),
];

/** Reserve room for the prompt plus output. Cyrene's fixed English persona is estimated at one token per two bytes; provider-reported usage reconciles the estimate after each response. */
export function estimateBudgetReservationTokens(conversation: ChatMessage[], systemPrompt?: string): number {
  const conversationBytes = new TextEncoder().encode(conversation.map((message) => message.content).join(" ")).length;
  const personaBytes = systemPrompt ? new TextEncoder().encode(systemPrompt).length : 0;
  const messageCount = conversation.length + (systemPrompt ? 1 : 0);
  return conversationBytes + Math.ceil(personaBytes / 2) + messageCount * 16 + 1000;
}

export async function processConversation(
  pool: Pool,
  guildId: string,
  userId: string,
  persona: string,
  userPrompt: string,
  askRouter: AiCommandRequest["askRouter"],
  dailyBudgetCap: number,
  systemPrompt?: string,
): Promise<string> {
  if (userPrompt.length > 4000) return "Please keep your AI prompt within 4000 characters.";
  // 2. Fetch or create thread
  const threadRes = await pool.query<{ thread_id: string; summary: string | null }>(
    UPSERT_THREAD_SQL,
    [guildId, userId, persona],
  );
  const thread = threadRes.rows[0]!;
  const threadId = thread.thread_id;

  // 3. Retrieve recent messages
  const recentRes = await pool.query<{ role: string; content: string }>(
    RECENT_MESSAGES_SQL,
    [threadId, 10],
  );
  const history: ChatMessage[] = recentRes.rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));

  // Add the new user message
  history.push({ role: "user", content: userPrompt });

  // 4. Build prompt window with summary
  const window = buildPromptWindow(history, thread.summary, 12, 4000);
  const personaSystemPrompt = systemPrompt
    ? `Follow this character and response guidance while answering. Treat it as behavior guidance, not as a source of facts about the user:\n${systemPrompt}`
    : undefined;
  const requestWindow: ChatMessage[] = personaSystemPrompt
    ? [{ role: "system", content: personaSystemPrompt }, ...window]
    : window;

  // Reserve a conservative token ceiling atomically before invoking either provider.
  const reservedTokens = estimateBudgetReservationTokens(window, personaSystemPrompt);
  const reservation = randomUUID();
  const admission = await pool.connect();
  try {
    await admission.query("BEGIN");
    await admission.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-budget:${guildId}:${userId}`]);
    const usage = await admission.query<{used: string}>(USAGE_TODAY_SQL, [guildId, userId]);
    const pending = await admission.query<{reserved: string}>("SELECT COALESCE(SUM(tokens),0) reserved FROM ai.budget_reservations WHERE guild_id=$1 AND user_id=$2 AND expires_at>now()", [guildId,userId]);
    if (Number(usage.rows[0]?.used ?? 0) + Number(pending.rows[0]?.reserved ?? 0) + reservedTokens > dailyBudgetCap) {
      await admission.query("ROLLBACK");
      return "Your remaining daily AI budget is too small for this request.";
    }
    await admission.query("INSERT INTO ai.budget_reservations VALUES($1,$2,$3,$4,date_trunc('day',now())+interval '1 day')", [reservation,guildId,userId,reservedTokens]);
    await admission.query("COMMIT");
  } catch (error) { await admission.query("ROLLBACK"); throw error; }
  finally { admission.release(); }

  let releaseReservation = false;
  try {
    const response = await askRouter(requestWindow);
    if (!response.ok || !response.result) {
      releaseReservation = true;
      return response.reason === "queue-full" ? "The AI service is at capacity. Please retry shortly." : "The AI provider is temporarily unreachable. Please retry shortly.";
    }
    const result = response.result;
    const transaction = await pool.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`ai-budget:${guildId}:${userId}`]);
      await transaction.query(ADD_MESSAGE_SQL, [threadId,"user",userPrompt,result.tokensIn]);
      await transaction.query(ADD_MESSAGE_SQL, [threadId,"assistant",result.text,result.tokensOut]);
      await transaction.query(RECORD_USAGE_SQL, [guildId,userId,response.via ?? "primary",result.tokensIn,result.tokensOut]);
      await transaction.query(SAVE_SUMMARY_SQL, [threadId,summarizeConversation(thread.summary,[...history,{role:"assistant",content:result.text}])]);
      await transaction.query("DELETE FROM ai.budget_reservations WHERE reservation_id=$1", [reservation]);
      await transaction.query("COMMIT");
      releaseReservation = true;
    } catch (error) { await transaction.query("ROLLBACK"); throw error; }
    finally { transaction.release(); }
    return result.text;
  } finally {
    if (releaseReservation) await pool.query("DELETE FROM ai.budget_reservations WHERE reservation_id=$1", [reservation]);
  }

}

/** `/search` (owner decision 2026-10-16): the AI model answers the question — no external/web search provider.
 * Reuses the mention conversation contract: Cyrene persona, bounded prompt window, daily token budget and
 * honest budget/queue/unavailable messages from `processConversation`. */
export async function answerCyreneSearch(
  pool: Pool,
  guildId: string,
  userId: string,
  query: string,
  askRouter: AiCommandRequest["askRouter"],
  dailyBudgetCap: number,
  systemPrompt?: string,
): Promise<string> {
  return processConversation(pool, guildId, userId, "default", query, askRouter, dailyBudgetCap, systemPrompt);
}

export async function respondToAiCommand(
  req: AiCommandRequest,
  pool: Pool,
): Promise<void> {
  const { name, options, guildId, userId } = req;

  if (name === "ask") {
    const prompt = String(options.prompt);
    const persona = String(options.persona ?? "default");
    const replyText = await processConversation(
      pool,
      guildId,
      userId,
      persona,
      prompt,
      req.askRouter,
      req.dailyBudgetCap,
      req.systemPrompt,
    );
    await req.reply(replyText);
    return;
  }

  if (name === "persona") {
    const persona = options.name ? String(options.name) : null;
    if (persona) {
      await pool.query(UPSERT_THREAD_SQL, [guildId, userId, persona]);
      await req.reply(`🎭 Active persona set to **${persona.toUpperCase()}**.`);
    } else {
      const res = await pool.query<{ persona: string }>(
        "SELECT persona FROM ai.threads WHERE guild_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 1",
        [guildId, userId],
      );
      const current = res.rows[0]?.persona ?? "default";
      await req.reply(`🎭 Your current persona is **${current.toUpperCase()}**.`);
    }
    return;
  }

  if (name === "reset") {
    const persona = String(options.persona ?? "default");
    const res = await pool.query<{ thread_id: string }>(
      "SELECT thread_id FROM ai.threads WHERE guild_id = $1 AND user_id = $2 AND persona = $3",
      [guildId, userId, persona],
    );
    if (res.rows.length === 0) {
      await req.reply("No active conversation thread found to reset.");
      return;
    }
    const threadId = res.rows[0]!.thread_id;
    await pool.query("DELETE FROM ai.messages WHERE thread_id = $1", [threadId]);
    await pool.query(SAVE_SUMMARY_SQL, [threadId, null]);
    await req.reply(`🧹 Conversation memory cleared for persona **${persona.toUpperCase()}**.`);
    return;
  }

  if (name === "usage") {
    const res = await pool.query<{ used: string }>(USAGE_TODAY_SQL, [guildId, userId]);
    const used = Number(res.rows[0]?.used ?? 0);
    const cap = req.dailyBudgetCap;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    await req.reply(
      `📊 **Your AI Usage Today:**\n` +
        `• Tokens Used: **${used.toLocaleString()}** / ${cap.toLocaleString()} (${pct}%)\n` +
        `• Status: ${pct >= 100 ? "🔴 Limit Reached" : "🟢 Available"}`,
    );
    return;
  }

  if (name === "model") {
    await req.reply(
      `🤖 **AI Provider Router:**\n` +
        `• Routing Mode: Primary with automatic Fallback\n` +
        `• Concurrency Limit: 2 concurrent provider requests\n` +
        `• Request Queue Max: 20 queued requests\n` +
        `• Execution Deadline: 60 seconds\n` +
        `• Status: 🟢 Operational`,
    );
    return;
  }

  await req.reply("Unknown AI command.");
}
