export interface VoiceXpState {
  userId: string;
  channelId: string | null;
  isBot: boolean;
  isAfk: boolean;
  selfDeaf: boolean;
  serverDeaf: boolean;
}

/** Award only active human listeners while at least two humans share the channel. */
export function eligibleVoiceXpUsers(states: VoiceXpState[]): string[] {
  const peopleByChannel = new Map<string, number>();
  for (const state of states) {
    if (!state.channelId || state.isBot || state.isAfk || state.selfDeaf || state.serverDeaf) continue;
    peopleByChannel.set(state.channelId, (peopleByChannel.get(state.channelId) ?? 0) + 1);
  }
  return states
    .filter((state) =>
      Boolean(
        state.channelId &&
          !state.isBot &&
          !state.isAfk &&
          !state.selfDeaf &&
          !state.serverDeaf &&
          (peopleByChannel.get(state.channelId) ?? 0) >= 2,
      ),
    )
    .map((state) => state.userId);
}

/** Stable per-member time bucket for retry-safe voice awards across process restarts. */
export function voiceXpEventKey(userId: string, nowMs: number, intervalSeconds: number): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("invalid-voice-xp-time");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3600)
    throw new Error("invalid-voice-xp-interval");
  if (!/^\d{17,20}$/.test(userId)) throw new Error("invalid-voice-xp-user");
  const bucket = Math.floor(nowMs / (intervalSeconds * 1000));
  return `voice:${intervalSeconds}:${userId}:${bucket}`;
}
