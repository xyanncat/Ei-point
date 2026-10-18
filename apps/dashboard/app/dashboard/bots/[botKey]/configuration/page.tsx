"use client";
// Bot · Configuration: enable/pause state for this bot in this server.
import { use } from "react";
import { useOverview } from "../../../../../components/staff/use-overview";
import { useStaff } from "../../../../../components/staff/staff-context";
import { BotStatePanel } from "../../../../../components/staff/panels";

export default function BotConfigurationPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = use(params);
  const { guild } = useStaff();
  const { data } = useOverview();
  const scopes = data?.guild.scopes ?? [];
  return <BotStatePanel guildId={guild} botKey={botKey} canOperate={scopes.includes("*")} />;
}
