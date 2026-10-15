import { randomInt } from "node:crypto";

export const SUITS = ["s", "h", "d", "c"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const HAND_SIZE = 5;
export const MIN_DECK = HAND_SIZE * 2;
const POINTS = [1, 3, 6, 10, 15, 20, 25, 50, 100];
const rankValue = (card: string) => Math.max(2, RANKS.indexOf(card[0] as typeof RANKS[number]) + 2);

export function createDeck(): string[] {
  return SUITS.flatMap(suit => RANKS.map(rank => `${rank}${suit}`));
}

export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function evaluateHand(cards: readonly string[]) {
  if (cards.length !== HAND_SIZE || cards.some(card => !/^[2-9TJQKA][shdc]$/.test(card)) || new Set(cards).size !== HAND_SIZE) {
    throw new Error("invalid-hand");
  }
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(rankValue(card), (counts.get(rankValue(card)) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const values = [...counts.keys()].sort((a, b) => a - b);
  const wheel = values.join(",") === "2,3,4,5,14";
  const straight = values.length === 5 && (values[4]! - values[0]! === 4 || wheel);
  const flush = new Set(cards.map(card => card[1])).size === 1;
  let rank = straight && flush ? 8 : groups[0]?.[1] === 4 ? 7 :
    groups[0]?.[1] === 3 && groups[1]?.[1] === 2 ? 6 : flush ? 5 :
    straight ? 4 : groups[0]?.[1] === 3 ? 3 :
    groups[0]?.[1] === 2 && groups[1]?.[1] === 2 ? 2 :
    groups[0]?.[1] === 2 ? 1 : 0;
  const tieBreak = groups.map(([value]) => wheel && value === 14 ? 1 : value);
  if (rank === 4 || rank === 8) tieBreak.splice(0, tieBreak.length, wheel ? 5 : values[4]!);
  return { rank, name: ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"][rank]!, points: POINTS[rank]!, tieBreak };
}

export function dealRound(deck: readonly string[]) {
  if (deck.length < MIN_DECK || new Set(deck).size !== deck.length || deck.some(card => !/^[2-9TJQKA][shdc]$/.test(card))) return null;
  const player = deck.slice(0, HAND_SIZE);
  const house = deck.slice(HAND_SIZE, MIN_DECK);
  return { player, house, rest: deck.slice(MIN_DECK) };
}

export function resolveRound(player: readonly string[], house: readonly string[]) {
  const playerHand = evaluateHand(player), houseHand = evaluateHand(house);
  let comparison = playerHand.rank - houseHand.rank;
  if (!comparison) for (let i = 0; i < playerHand.tieBreak.length && !comparison; i++) comparison = playerHand.tieBreak[i]! - houseHand.tieBreak[i]!;
  const outcome = comparison > 0 ? "win" : comparison < 0 ? "loss" : "push";
  return { player: playerHand, house: houseHand, outcome, points: outcome === "win" ? playerHand.points * 2 + 5 : outcome === "push" ? playerHand.points : 0 };
}

export function formatHand(cards: readonly string[]) {
  const suits: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  return cards.length ? cards.map(card => `${card[0]}${suits[card[1]!]}`).join(" ") : "—";
}
