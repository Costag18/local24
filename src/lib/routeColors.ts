/**
 * Route colours shared by the map, the next-buses board and the TV page.
 * TTC ships the same maroon for nearly every bus route, so routes are
 * coloured from a categorical palette by their position in the followed list.
 */

const PALETTE = [
  "#38bdf8", "#f59e0b", "#22c55e", "#e879f9", "#f87171",
  "#a3e635", "#60a5fa", "#fb923c", "#2dd4bf", "#c084fc",
  "#facc15", "#fb7185", "#93c5fd", "#fdba74",
];

export function routeColor(tag: string, index: number): string {
  // Keep the real line colours for the subway, which TTC does set correctly.
  if (tag === "1") return "#f8d40a";
  if (tag === "2") return "#00a651";
  if (tag === "4") return "#a21d68";
  return PALETTE[index % PALETTE.length];
}
