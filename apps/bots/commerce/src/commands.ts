import { randomBytes } from "node:crypto";
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import { canSettleCommerce } from "./authorization.js";
import {
  QUOTE_REWARD_CREDIT_SQL,
  RESERVE_REWARDS_SQL,
  buildUpiPayload,
  executeClaim,
  executeReject,
  executeSettle,
  newOrderToken,
  newReferralCode,
  cycleFor,
  rewardCreditFor,
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
  razorpayPage?: string;
}

export const commerceCommandDefinitions = [
  new SlashCommandBuilder()
    .setName("orders")
    .setDescription("Manage orders and payments")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("list").setDescription("List your orders in this server")
      .addIntegerOption((opt) => opt.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(99)))
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new service order")
        .addStringOption((opt) => opt.setName("sku").setDescription("Item SKU from catalog").setRequired(true).setAutocomplete(true)),
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
    )
    .addSubcommand((sub) => sub
      .setName("settle")
      .setDescription("Staff settlement for a claimed order")
      .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID to settle").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("review")
      .setDescription("Staff: list claimed orders awaiting review")
      .addIntegerOption((opt) => opt.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(99)))
    .addSubcommand((sub) => sub
      .setName("reject")
      .setDescription("Staff: reject a pending or claimed order")
      .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID to reject").setRequired(true))),

  new SlashCommandBuilder()
    .setName("referral")
    .setDescription("Referral link generation and reward tracking")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("link").setDescription("Get your unique referral code and link"))
    .addSubcommand((sub) => sub.setName("redeem").setDescription("Apply a referral code to your future order")
      .addStringOption((opt) => opt.setName("code").setDescription("Referral code").setRequired(true).setMaxLength(24)))
    .addSubcommand((sub) => sub.setName("status").setDescription("View referral stats and current month rewards")),
  new SlashCommandBuilder()
    .setName("payment")
    .setDescription("Show available payment methods and checkout guidance")
    .setDMPermission(false),
];

export async function respondToCommerceCommand(
  req: CommerceCommandRequest,
  pool: Pool,
): Promise<void> {
  const { name, subcommand, options, guildId, userId, isOwner, canManage, userScopes } = req;
  const isPrivileged = canSettleCommerce({ isOwner, canManage, userScopes });

  if (name === "orders") {
    if (subcommand === "list") {
      const size = 5, page = Math.max(1, Math.min(99, Number(options.page ?? 1) || 1));
      const total = Number((await pool.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM commerce.orders WHERE guild_id=$1 AND buyer_id=$2",
        [guildId, userId],
      )).rows[0]?.total ?? 0);
      if (total === 0) {
        await req.reply("📦 You have no orders in this server yet. Create one with `/orders create` or the website checkout.");
        return;
      }
      const pages = Math.max(1, Math.ceil(total / size)), current = Math.min(page, pages);
      const rows = (await pool.query<{ order_id: string; public_id: string; sku: string; service_name: string | null; amount_minor: string; status: OrderStatus; created_at: Date }>(
        "SELECT order_id,public_id,sku,service_name,amount_minor,status,created_at FROM commerce.orders WHERE guild_id=$1 AND buyer_id=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        [guildId, userId, size, (current - 1) * size],
      )).rows;
      await req.reply(
        `📦 **Your orders — page ${current} of ${pages}**\n` +
          rows.map((o) => `• **${o.service_name ?? o.sku}** — ₹${(Number(o.amount_minor) / 100).toFixed(2)} — **${o.status.toUpperCase()}**\n  Order \`${o.order_id}\` (${o.public_id}) · ${new Date(o.created_at).toLocaleDateString()}`).join("\n"),
      );
      return;
    }
    if (subcommand === "create") {
      if (!buildUpiPayload({payeeVpa:req.payeeVpa,payeeName:req.payeeName?.trim()??"",amountMinor:1,note:"configuration check"}) || !req.paymentOrigin) {
        await req.reply("Payments are not configured for Discord checkout. Use the website checkout for configured payment methods or contact staff.");
        return;
      }
      const sku = String(options.sku).trim();
      const catRes = await pool.query<{ sku: string; name: string; price_minor: string; currency: string; membership_days: number }>(
        "SELECT sku, name, price_minor, currency, membership_days FROM commerce.catalog WHERE sku = $1 AND active = TRUE",
        [sku],
      );
      if (catRes.rows.length === 0) {
        await req.reply("❌ Invalid SKU or service is inactive. Pick one of the suggested services or browse the website catalog.");
        return;
      }

      const item = catRes.rows[0]!;
      const priceMinor = Number(item.price_minor);
      if(item.currency!=="INR" || !Number.isSafeInteger(priceMinor) || priceMinor<=0){await req.reply("This service is unavailable for Discord UPI checkout. Use the website checkout for configured payment methods.");return;}
      const { token, hash } = newOrderToken();
      const idempotencyKey = `ord-${req.key}`;
      const publicId=`RP-${randomBytes(3).toString("hex").toUpperCase()}`;
      const client = await pool.connect();
      let orderId: string | undefined;
      let referralInvalid = false;
      let credit: { appliedMinor: number; rewardIds: string[] } = { appliedMinor: 0, rewardIds: [] };
      let payableMinor = priceMinor;
      try {
        await client.query("BEGIN");
        const referralScope = `guild:${guildId}:user:${userId}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`commerce-referral:${referralScope}`]);
        const setting = await client.query<{ version: number; value: { code?: string | null } }>(
          "SELECT version, value FROM config.settings WHERE scope=$1 AND key='commerce.referral-code' ORDER BY version DESC LIMIT 1 FOR UPDATE",
          [referralScope],
        );
        const referralCode = typeof setting.rows[0]?.value?.code === "string" ? setting.rows[0].value.code : null;
        // Earned referral credit applies to this INR order as whole reserved reward rows.
        credit = rewardCreditFor(
          (await client.query(QUOTE_REWARD_CREDIT_SQL, [guildId, userId, cycleFor(new Date())])).rows,
          priceMinor,
        );
        payableMinor = priceMinor - credit.appliedMinor;
        if (referralCode) {
          const validReferral = await client.query<{ referrer_id: string }>(
            "SELECT referrer_id FROM commerce.referrals WHERE code=$1 AND guild_id=$2 AND cycle=$3",
            [referralCode, guildId, cycleFor(new Date())],
          );
          if (!validReferral.rows[0] || validReferral.rows[0].referrer_id === userId) {
            referralInvalid = true;
            await client.query(
              "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,'commerce.referral-code',$2,$3,$4)",
              [referralScope, setting.rows[0]!.version + 1, { code: null }, userId],
            );
            await client.query("COMMIT");
          } else {
            const orderRes = await client.query<{ order_id: string }>(
              `INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key, service_name, membership_days,public_id,referral_code,credit_applied_minor)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,$10,$11)
               RETURNING order_id`,
              [guildId, userId, sku, payableMinor, hash, idempotencyKey, item.name, item.membership_days, publicId, referralCode, credit.appliedMinor],
            );
            orderId = orderRes.rows[0]!.order_id;
            if (credit.rewardIds.length) await client.query(RESERVE_REWARDS_SQL, [credit.rewardIds, orderId]);
            await client.query(
              "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,'commerce.referral-code',$2,$3,$4)",
              [referralScope, setting.rows[0]!.version + 1, { code: null }, userId],
            );
            await client.query("COMMIT");
          }
        } else {
          const orderRes = await client.query<{ order_id: string }>(
            `INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key, service_name, membership_days,public_id,referral_code,credit_applied_minor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,NULL,$10)
             RETURNING order_id`,
            [guildId, userId, sku, payableMinor, hash, idempotencyKey, item.name, item.membership_days, publicId, credit.appliedMinor],
          );
          orderId = orderRes.rows[0]!.order_id;
          if (credit.rewardIds.length) await client.query(RESERVE_REWARDS_SQL, [credit.rewardIds, orderId]);
          await client.query("COMMIT");
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      if (referralInvalid) {
        await req.reply("Your saved referral code is no longer valid. Redeem another code before placing this order.");
        return;
      }
      if (!orderId) throw new Error("Order creation completed without an order ID");

      const upiUrl = buildUpiPayload({
        payeeVpa: req.payeeVpa,
        payeeName: req.payeeName,
        amountMinor: payableMinor,
        note: `Ei-${orderId.slice(0, 8)}`,
      });

      const verifyUrl = `${req.paymentOrigin}/verify?id=${publicId}`;

      await req.reply(
        `🧾 **Order Placed Successfully!**\n` +
          `• Order ID: \`${orderId}\`\n` +
          `• Item: **${item.name}** (\`${item.sku}\`)\n` +
          `• Amount: **₹${(payableMinor / 100).toFixed(2)}**\n` +
          (credit.appliedMinor > 0 ? `• Referral credit applied: **₹${(credit.appliedMinor / 100).toFixed(2)}**\n` : "") +
          `• Status: **Pending Payment**\n\n` +
          (upiUrl ? `📲 **UPI Pay Link:** <${upiUrl}>\n` : "") +
          `🔗 **Verification & Claim Page:** <${verifyUrl}>\n\n` +
          `*After payment, claim your order using \`/orders claim order_id:${orderId} proof:<your_utr_or_tx_id>\`*`,
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
        "SELECT order_id, sku, amount_minor, status, created_at, buyer_id FROM commerce.orders WHERE order_id = $1 AND guild_id=$2 AND (buyer_id=$3 OR $4::boolean)",
        [orderId,guildId,userId,isPrivileged],
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
      const idempotencyKey = `claim-${req.key}`;

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
          { orderId, proofRef: proof, idempotencyKey, guildId, buyerId:userId },
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

  if (name === "orders" && subcommand === "settle") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: `commerce-settle` role or Manage Server required.");
      return;
    }
    const orderId = String(options.order_id).trim();
    const idempotencyKey = `settle-${req.key}`;

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
        { orderId, settledBy: userId, idempotencyKey, guildId, referralRewardMinor:Number(process.env.COMMERCE_REFERRAL_REWARD_MINOR??0) },
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

  if (name === "orders" && subcommand === "review") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: `commerce-settle` role or Manage Server required.");
      return;
    }
    const size = 5, page = Math.max(1, Math.min(99, Number(options.page ?? 1) || 1));
    const total = Number((await pool.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM commerce.orders WHERE guild_id=$1 AND status='claimed'",
      [guildId],
    )).rows[0]?.total ?? 0);
    if (total === 0) {
      await req.reply("📭 No claimed orders await review.");
      return;
    }
    const pages = Math.max(1, Math.ceil(total / size)), current = Math.min(page, pages);
    const rows = (await pool.query<{ order_id: string; public_id: string; service_name: string | null; sku: string; amount_minor: string; proof_ref: string | null; created_at: Date }>(
      "SELECT o.order_id,o.public_id,o.service_name,o.sku,o.amount_minor,c.proof_ref,o.created_at FROM commerce.orders o LEFT JOIN commerce.claims c USING(order_id) WHERE o.status='claimed' AND o.guild_id=$1 ORDER BY o.created_at ASC LIMIT $2 OFFSET $3",
      [guildId, size, (current - 1) * size],
    )).rows;
    await req.reply(
      `🕵️ **Claimed orders awaiting review — page ${current} of ${pages}**\n` +
        rows.map((o) => `• **${o.service_name ?? o.sku}** — ₹${(Number(o.amount_minor) / 100).toFixed(2)} — proof \`${o.proof_ref ?? "unavailable"}\`\n  Order \`${o.order_id}\` (${o.public_id}) — settle with \`/orders settle\` or reject with \`/orders reject\``).join("\n"),
    );
    return;
  }

  if (name === "orders" && subcommand === "reject") {
    if (!isPrivileged) {
      await req.reply("❌ Permission denied: `commerce-settle` role or Manage Server required.");
      return;
    }
    const orderId = String(options.order_id).trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rejectResult = await executeReject(
        {
          query: async (sql: string, params: unknown[]) => {
            const r = await client.query(sql, params);
            return { rows: r.rows, rowCount: r.rowCount ?? 0 };
          },
        },
        { orderId, guildId },
      );
      if (!rejectResult.ok) {
        await client.query("ROLLBACK");
        await req.reply(`❌ Rejection failed: order is ${rejectResult.reason}.`);
        return;
      }
      await client.query("COMMIT");
      await req.reply(`🚫 **Order \`${orderId}\` rejected** by <@${userId}>.`);
    } catch (err) {
      await client.query("ROLLBACK");
      await req.reply("❌ Rejection failed safely. Please retry.");
    } finally {
      client.release();
    }
    return;
  }

  if (name === "referral") {
    const currentCycle = cycleFor(new Date());

    if (subcommand === "link") {
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

    if (subcommand === "status") {
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

    if (subcommand === "redeem") {
      const code = String(options.code ?? "").trim().toUpperCase();
      const referral = await pool.query<{ referrer_id: string }>(
        "SELECT referrer_id FROM commerce.referrals WHERE code=$1 AND guild_id=$2 AND cycle=$3",
        [code, guildId, currentCycle],
      );
      if (!referral.rows[0] || referral.rows[0].referrer_id === userId) {
        await req.reply("Referral code is expired, unknown, or belongs to you.");
        return;
      }
      const scope = `guild:${guildId}:user:${userId}`;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`commerce-referral:${scope}`]);
        const current = await client.query<{ version: number }>(
          "SELECT COALESCE(MAX(version),0)::int AS version FROM config.settings WHERE scope=$1 AND key='commerce.referral-code'",
          [scope],
        );
        await client.query(
          "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,'commerce.referral-code',$2,$3,$4)",
          [scope, current.rows[0]!.version + 1, JSON.stringify({ code }), userId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
      await req.reply(`Referral code \`${code}\` is saved for your next order.`);
      return;
    }
  }

  if (name === "payment") {
    const upiReady = Boolean(buildUpiPayload({ payeeVpa: req.payeeVpa, payeeName: req.payeeName?.trim() ?? "", amountMinor: 1, note: "configuration check" }));
    const pageReady = /^https:\/\/razorpay\.me\/[A-Za-z0-9@._-]{2,64}$/.test((req.razorpayPage ?? "").trim().replace(/\/+$/, ""));
    const methods = [upiReady ? "UPI (server-quoted amount)" : null, pageReady ? "Razorpay hosted payment page (card, UPI or wallet; staff-verified)" : null].filter(Boolean).join(", ") || "none";
    await req.reply(`Configured payment methods: ${methods}. Orders show their exact payment instructions after creation. Staff verify every payment before fulfilment — never pay outside the instructions shown with your order.`);
    return;
  }

  await req.reply("Unknown commerce command.");
}

// Autocomplete for `/orders create sku`: published catalog only, capped and
// shaped to Discord limits (25 choices, 100-char labels).
export async function catalogChoices(pool: Pool, term: string): Promise<Array<{ name: string; value: string }>> {
  const clean = term.trim().slice(0, 100);
  const rows = (await pool.query<{ sku: string; name: string }>(
    "SELECT sku,name FROM commerce.catalog WHERE active=true AND ($1='' OR name ILIKE '%'||$1||'%' OR sku ILIKE '%'||$1||'%') ORDER BY price_minor LIMIT 25",
    [clean],
  )).rows;
  return rows.map((r) => ({ name: `${r.name} (${r.sku})`.slice(0, 100), value: r.sku }));
}
