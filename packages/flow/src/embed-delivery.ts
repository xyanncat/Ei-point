export function registeredBotToken(
  botKey: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const named =
    env[
      `DISCORD_${botKey.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_BOT_TOKEN`
    ];
  return named || (env.BOT_KEY === botKey ? env.BOT_TOKEN : undefined);
}
/** Every send is an explicit durable staff job. Verify bot identity and guild channel immediately before REST send. */
export async function sendDashboardEmbed(
  payload: Record<string, any>,
  token: string,
  applicationId: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const request = async (path: string, body?: unknown) => {
    const response = await fetchFn(`https://discord.com/api/v10${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("discord-delivery-unconfirmed");
    return response.json() as Promise<Record<string, any>>;
  };
  if (
    !/^\d{17,20}$/.test(String(payload.guild_id)) ||
    !/^\d{17,20}$/.test(String(payload.channel_id))
  )
    throw new Error("invalid-embed-target");
  const me = await request("/users/@me");
  if (me.id !== applicationId || me.bot !== true)
    throw new Error("bot-identity-mismatch");
  const channel = await request(`/channels/${payload.channel_id}`);
  if (
    channel.guild_id !== payload.guild_id ||
    ![0, 5, 10, 11, 12].includes(channel.type)
  )
    throw new Error("channel-guild-mismatch");
  const embed: Record<string, any> = {
    color: parseInt(String(payload.color).slice(1), 16),
    fields: payload.fields ?? [],
  };
  for (const key of ["title", "description", "url"])
    if (payload[key]) embed[key] = payload[key];
  if (payload.image) embed.image = { url: payload.image };
  if (payload.thumbnail) embed.thumbnail = { url: payload.thumbnail };
  if (payload.footer) embed.footer = { text: payload.footer };
  if (payload.author?.name)
    embed.author = {
      name: payload.author.name,
      ...(payload.author.url ? { url: payload.author.url } : {}),
      ...(payload.author.iconUrl ? { icon_url: payload.author.iconUrl } : {}),
    };
  const components = payload.buttons?.length
    ? [
        {
          type: 1,
          components: payload.buttons.map((b: any) => ({
            type: 2,
            style: 5,
            label: b.label,
            url: b.url,
          })),
        },
      ]
    : [];
  await request(`/channels/${payload.channel_id}/messages`, {
    embeds: [embed],
    components,
    allowed_mentions: { parse: [] },
    nonce: payload.delivery_nonce,
    enforce_nonce: true,
  });
}
