import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import {
  buildUpiPayload,
  executeClaim,
  executeSettle,
  newOrderToken,
  newReferralCode,
  cycleFor,
  type OrderStatus,
} from "@ei-point/module-commerce";

export interface CommerceCommandRequest {
  name: string;
  subcommandGroup?: string | undefined;
  subcommand?: string | undefined;
  options: Record<string, string | number | boolean>;
  guildId: string;
  userId: string;
  key: string;
  isOwner: boolean;
  canManage: boolean;
  userScopes: string[];
  defer(): Promise<void>;
  reply(text: string): Promise<void>;
  paymentOrigin: string;
  payeeVpa: string;
  payeeName: string;
  usdtAddress: string;
}

export const commerceCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("catalog")
    .setDescription("View available digital services and packages")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Manage orders and payments")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new service order")
        .addStringOption((opt) => opt.setName("sku").setDescription("Item SKU from catalog").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check the status of an existing order")
        .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("claim")
        .setDescription("Submit payment proof for an order")
        .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID").setRequired(true))
        .addStringOption((opt) =>
          opt.setName("proof").setDescription("Payment reference / UTR / transaction hash").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("settle")
    .setDescription("Staff settlement for a claimed order")
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID to settle").setRequired(true)),

  new SlashCommandBuilder()
    .setName("referral")
    .setDescription("Referral link generation and reward tracking")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("code").setDescription("Get your unique referral code and link"))
    .addSubcommand((sub) => sub.setName("stats").setDescription("View referral stats and current month rewards")),
];

export async function respondToCommerceCommand(
  req: CommerceCommandRequest,
  pool: Pool,
): Promise<void> {
  const { name, subcommand, options, guildId, userId, isOwner, canManage, userScopes } = req;
  const isPrivileged = isOwner || canManage || userScopes.includes("commerce-settle");

  if (name === "catalog") {
    const res = await pool.query<{ sku: string; name: string; price_minor: string; currency: string }>(
      "SELECT sku, name, price_minor, currency FROM commerce.catalog WHERE active = TRUE ORDER BY price_minor ASC",
    );
    if (res.rows.length === 0) {
      await req.reply("The catalog is currently empty.");
      return;
    }
    const lines = res.rows.map((item) => {
      const price = (Number(item.price_minor) / 100).toFixed(2);
      return `• **${item.name}** (\`${item.sku}\`) — ${item.currency} ${price}`;
    });
    await req.reply(`🛒 **Service Catalog:**\n${lines.join("\n")}\n\n*Use \`/order create <sku>\` to place an order.*`);
    return;
  }

  if (name === "order") {
    if (subcommand === "create") {
      const sku = String(options.sku).trim();
      const catRes = await pool.query<{ sku: string; name: string; price_minor: string; currency: string }>(
        "SELECT sku, name, price_minor, currency FROM commerce.catalog WHERE sku = $1 AND active = TRUE",
        [sku],
      );
      if (catRes.rows.length === 0) {
        await req.reply("❌ Invalid SKU or service is inactive. Use `/catalog` to view active items.");
        return;
      }

      const item = catRes.rows[0]!;
      const priceMinor = Number(item.price_minor);
      const { token, hash } = newOrderToken();
      const idempotencyKey = `ord-${guildId}-${userId}-${sku}-${Date.now()}`;

      const orderRes = await pool.query<{ order_id: string }>(
        `INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING order_id`,
        [guildId, userId, sku, priceMinor, hash, idempotencyKey],
      );
      const orderId = orderRes.rows[0]!.order_id;

      const upiUrl = buildUpiPayload({
        payeeVpa: req.payeeVpa || "payments@upi",
        payeeName: req.payeeName || "Ei Point",
        amountMinor: priceMinor,
        note: `Ei-${orderId.slice(0, 8)}`,
      });

      const verifyUrl = `${req.paymentOrigin}/verify?token=${token}`;

      await req.reply(
        `🧾 **Order Placed Successfully!**\n` +
          `• Order ID: \`${orderId}\`\n` +
          `• Item: **${item.name}** (\`${item.sku}\`)\n` +
          `• Amount: **₹${(priceMinor / 100).toFixed(2)}**\n` +
          `• Status: **Pending Payment**\n\n` +
          (upiUrl ? `📲 **UPI Pay Link:** <${upiUrl}>\n` : "") +
          (req.usdtAddress ? `💳 **USDT (TRC20):** \`${req.usdtAddress}\`\n` : "") +
          `🔗 **Verification & Claim Page:** <${verifyUrl}>\n\n` +
          `*After payment, claim your order using \`/order claim order_id:${orderId} proof:<your_utr_or_tx_id>\`*`,
      );
      return;
    }

    if (subcommand === "status") {
      const orderId = String(options.order_id).trim();
      const res = await pool.query<{
        order_id: string;
        sku: string;
        amount_minor: string;
        status: OrderStatus;
        created_at: Date;
        buyer_id: string;
      }>(
        "SELECT order_id, sku, amount_minor, status, created_at, buyer_id FROM commerce.orders WHERE order_id = $1",
        [orderId],
      );
      if (res.rows.length === 0) {
        await req.reply("❌ Order not found.");
        return;
      }
      const ord = res.rows[0]!;
      await req.reply(
        `📦 **Order Status:**\n` +
          `• Order ID: \`${ord.order_id}\`\n` +
          `• SKU: \`${ord.sku}\`\n` +
          `• Buyer: <@${ord.buyer_id}>\n` +
          `• Amount: ₹${(Number(ord.amount_minor) / 100).toFixed(2)}\n` +
          `• Status: **${ord.status.toUpperCase()}**\n` +
          `• Created: ${new Date(ord.created_at).toLocaleString()}`,
      );
      return;
    }

    if (subcommand === "claim") {
      const orderId = String(options.order_id).trim();
      const proof = String(options.proof).trim();
      const idempotencyKey = `claim-${orderId}-${Date.now()}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimResult = await executeClaim(
          {
            query: async (sql: string, params: unknown[]) => {
              const r = await client.query(sql, params);
              return { rows: r.rows, rowCount: r.rowCount ?? 0 };
            },
          },
          { orderId, proofRef: proof, idempotencyKey },
        );
        if (!claimResult.ok) {
          await client.query("ROLLBACK");
          await req.reply(`❌ Payment claim failed: order is ${claimResult.reason}.`);
          return;
        }
        await client.query("COMMIT");
        await req.reply(
          `✅ **Payment Claim Submitted!** Order \`${orderId}\` is now under staff verification.`,
        );
      } catch (err) {
        await client.query("ROLLBACK");
        await req.reply("❌ Claim processing failed safely. Please retry.");
      } finally {
        client.release();
      }
      return;
    }
  }

  if (name === "settle") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: `commerce-settle` role or Manage Server required.");
      return;
    }
    const orderId = String(options.order_id).trim();
    const idempotencyKey = `settle-${orderId}-${Date.now()}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const settleResult = await executeSettle(
        {
          query: async (sql: string, params: unknown[]) => {
            const r = await client.query(sql, params);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        },
        { orderId, settledBy: userId, idempotencyKey },
      );
      if (!settleResult.ok) {
        await client.query("ROLLBACK");
        await req.reply(`❌ Settlement failed: order is ${settleResult.reason}.`);
        return;
      }
      await client.query("COMMIT");
      await req.reply(`🎉 **Order \`${orderId}\` settled successfully** by <@${userId}>.`);
    } catch (err) {
      await client.query("ROLLBACK");
      await req.reply("❌ Settlement failed safely. Please retry.");
    } finally {
      client.release();
    }
    return;
  }

  if (name === "referral") {
    const currentCycle = cycleFor(new Date());

    if (subcommand === "code") {
      let refRes = await pool.query<{ code: string }>(
        "SELECT code FROM commerce.referrals WHERE guild_id = $1 AND referrer_id = $2 AND cycle = $3",
        [guildId, userId, currentCycle],
      );
      let code = refRes.rows[0]?.code;
      if (!code) {
        code = newReferralCode("EI");
        await pool.query(
          "INSERT INTO commerce.referrals (code, guild_id, referrer_id, cycle, uses) VALUES ($1, $2, $3, $4, 0)",
          [code, guildId, userId, currentCycle],
        );
      }
      const refUrl = `${req.paymentOrigin}/referrals?code=${code}`;
      await req.reply(
        `🎁 **Your Referral Code for Cycle \`${currentCycle}\`:**\n` +
          `• Code: \`${code}\`\n` +
          `• Link: <${refUrl}>\n\n` +
          `*Share this link to earn referral discounts and monthly commissions.*`,
      );
      return;
    }

    if (subcommand === "stats") {
      const [refRes, rewardsRes] = await Promise.all([
        pool.query<{ uses: number }>(
          "SELECT COALESCE(SUM(uses), 0)::int as uses FROM commerce.referrals WHERE guild_id = $1 AND referrer_id = $2 AND cycle = $3",
          [guildId, userId, currentCycle],
        ),
        pool.query<{ amount_minor: string; status: string }>(
          "SELECT amount_minor, status FROM commerce.rewards WHERE guild_id = $1 AND user_id = $2 AND cycle = $3",
          [guildId, userId, currentCycle],
        ),
      ]);

      const uses = refRes.rows[0]?.uses ?? 0;
      const rewardLines = rewardsRes.rows.map(
        (r) => `• ₹${(Number(r.amount_minor) / 100).toFixed(2)} [${r.status.toUpperCase()}]`,
      );

      await req.reply(
        `📊 **Referral Performance (${currentCycle}):**\n` +
          `• Total Successful Referrals: **${uses}**\n` +
          `• Active Rewards:\n${rewardLines.length ? rewardLines.join("\n") : "• No rewards accumulated this cycle yet."}`,
      );
      return;
    }
  }

  await req.reply("Unknown commerce command.");
}
