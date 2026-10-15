import { randomBytes } from "node:crypto";
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Pool } from "pg";
import { canSettleCommerce } from "./authorization.js";
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
    .setName("orders")
    .setDescription("Manage orders and payments")
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName("list").setDescription("List services available for orders"))
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
    )
    .addSubcommand((sub) => sub
      .setName("settle")
      .setDescription("Staff settlement for a claimed order")
      .addStringOption((opt) => opt.setName("order_id").setDescription("Order UUID to settle").setRequired(true))),

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
      const catalog = await pool.query<{ sku: string; name: string; price_minor: string; currency: string }>(
        "SELECT sku,name,price_minor,currency FROM commerce.catalog WHERE active=true ORDER BY price_minor",
      );
      await req.reply(catalog.rows.length
        ? catalog.rows.map((item) => `• **${item.name}** (\`${item.sku}\`) — ${item.currency} ${(Number(item.price_minor) / 100).toFixed(2)}`).join("\n")
        : "No services are currently available.");
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
        await req.reply("❌ Invalid SKU or service is inactive. Use `/orders list` to view active items.");
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
      try {
        await client.query("BEGIN");
        const referralScope = `guild:${guildId}:user:${userId}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`commerce-referral:${referralScope}`]);
        const setting = await client.query<{ version: number; value: { code?: string | null } }>(
          "SELECT version, value FROM config.settings WHERE scope=$1 AND key='commerce.referral-code' ORDER BY version DESC LIMIT 1 FOR UPDATE",
          [referralScope],
        );
        const referralCode = typeof setting.rows[0]?.value?.code === "string" ? setting.rows[0].value.code : null;
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
              `INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key, service_name, membership_days,public_id,referral_code)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,$10)
               RETURNING order_id`,
              [guildId, userId, sku, priceMinor, hash, idempotencyKey, item.name, item.membership_days, publicId, referralCode],
            );
            orderId = orderRes.rows[0]!.order_id;
            await client.query(
              "INSERT INTO config.settings(scope,key,version,value,updated_by) VALUES($1,'commerce.referral-code',$2,$3,$4)",
              [referralScope, setting.rows[0]!.version + 1, { code: null }, userId],
            );
            await client.query("COMMIT");
          }
        } else {
          const orderRes = await client.query<{ order_id: string }>(
            `INSERT INTO commerce.orders (guild_id, buyer_id, sku, amount_minor, order_token_hash, idempotency_key, service_name, membership_days,public_id,referral_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,NULL)
             RETURNING order_id`,
            [guildId, userId, sku, priceMinor, hash, idempotencyKey, item.name, item.membership_days, publicId],
          );
          orderId = orderRes.rows[0]!.order_id;
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
        amountMinor: priceMinor,
        note: `Ei-${orderId.slice(0, 8)}`,
      });

      const verifyUrl = `${req.paymentOrigin}/verify?id=${publicId}`;

      await req.reply(
        `🧾 **Order Placed Successfully!**\n` +
          `• Order ID: \`${orderId}\`\n` +
          `• Item: **${item.name}** (\`${item.sku}\`)\n` +
          `• Amount: **₹${(priceMinor / 100).toFixed(2)}**\n` +
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
    await req.reply(`Configured payment methods: ${upiReady ? "UPI (server-quoted amount)" : "none"}. Orders show their exact payment instructions after creation. Card and wallet checkout are not enabled in this deployment.`);
    return;
  }

  await req.reply("Unknown commerce command.");
}
