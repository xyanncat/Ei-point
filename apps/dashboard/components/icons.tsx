export type IconName =
  | "crown"
  | "overview"
  | "bots"
  | "shield"
  | "activity"
  | "search"
  | "refresh"
  | "chevron"
  | "logout"
  | "music"
  | "spark"
  | "cards"
  | "store"
  | "menu";
const paths: Record<IconName, string> = {
  crown: "M3 6l4 4 5-7 5 7 4-4-2 13H5L3 6zm3 10h12",
  overview: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  bots: "M8 4v3m8-3v3M5 7h14v13H5zM9 11v3m6-3v3m-6 3h6M2 11v5m20-5v5",
  shield: "M12 3l9 4v5c0 5-5 8-9 10-4-2-9-5-9-10V7l9-4zm-4 9l3 3 5-6",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12l6 6",
  refresh: "M20 8a9 9 0 1 0 0 8M20 3v5h-5",
  chevron: "M6 9l6 6 6-6",
  logout: "M9 3H4v18h5m5-14l5 5-5 5m-6-5h13",
  music:
    "M9 18V5l11-2v13M9 8l11-2M9 18c0 2-6 4-6 1s6-4 6-1zm11-2c0 2-6 4-6 1s6-4 6-1z",
  spark: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7z",
  cards: "M5 5l14 1-1 16-14-1L5 5zm4-4l13 3-1 14M9 12l3-3 3 3-3 3-3-3z",
  store: "M3 9l2-6h14l2 6M4 10v11h16V10M9 21v-7h6v7M2 9h20",
  menu: "M3 6h18M3 12h18M3 18h18",
};
export function Icon({
  name,
  className,
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
