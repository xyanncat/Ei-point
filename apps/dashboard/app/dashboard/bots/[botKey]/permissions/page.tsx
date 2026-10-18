"use client";
// Bot · Command permissions: Discord role restrictions for this bot.
import { use } from "react";
import { useOverview } from "../../../../../components/staff/use-overview";
import { useStaff } from "../../../../../components/staff/staff-context";
import { CommandPermissionsPanel } from "../../../../../components/staff/panels";

export default function BotPermissionsPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = use(params);
  const { guild } = useStaff();
  const { data } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  return <CommandPermissionsPanel guildId={guild} botKey={botKey} canOperate={scopes.includes("*")} />;
}
