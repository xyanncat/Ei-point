import { SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  buildPromptWindow,
  budgetExceeded,
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

export async function processConversation(
  pool: Pool,
  guildId: string,
  userId: string,
  persona: string,
  userPrompt: string,
  askRouter: AiCommandRequest["askRouter"],
  dailyBudgetCap: number,
): Promise<string> {
  // 1. Check user budget
  const usageRes = await pool.query<{ used: string }>(USAGE_TODAY_SQL, [guildId, userId]);
  const usedToday = Number(usageRes.rows[0]?.used ?? 0);
  if (budgetExceeded(usedToday, dailyBudgetCap)) {
    return "⚠️ You have reached your daily AI usage limit. Please try again tomorrow.";
  }

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

  // 5. Ask router
  const response = await askRouter(window);
  if (!response.ok || !response.result) {
    if (response.reason === "queue-full") {
      return "⏳ The AI service is currently at capacity. Please try again in a few moments.";
    }
    return "❌ The AI provider is temporarily unreachable. Please retry shortly.";
  }

  const result = response.result;

  // 6. Persist user message and assistant reply
  await Promise.all([
    pool.query(ADD_MESSAGE_SQL, [threadId, "user", userPrompt, result.tokensIn]),
    pool.query(ADD_MESSAGE_SQL, [threadId, "assistant", result.text, result.tokensOut]),
    pool.query(RECORD_USAGE_SQL, [
      guildId,
      userId,
      response.via ?? "primary",
      result.tokensIn,
      result.tokensOut,
    ]),
  ]);

  return result.text;
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
