import type { LevelDefinition } from "./schema";
export const algorithms = [
  { id: "astar", name: "A*", short: "A*", description: "Seimbangkan biaya rute dan perkiraan jarak." },
  { id: "weighted-astar", name: "Weighted A*", short: "W·A*", description: "Kejar tujuan lebih agresif. Rutenya bisa lebih mahal." },
  { id: "greedy", name: "Greedy Best-First", short: "Greedy", description: "Dahulukan yang terlihat dekat. Waspadai jalan buntu." },
  { id: "dfs", name: "Depth-First Search", short: "DFS", description: "Terobos satu cabang. Bisa menang besar kalau jalurnya tepat." },
  { id: "bidirectional", name: "Bidirectional BFS", short: "Bi-BFS", description: "Cari dari start dan target sekaligus sampai bertemu." },
] as const;
export type AlgorithmId = (typeof algorithms)[number]["id"];
export const getAlgorithm = (id: AlgorithmId) => algorithms.find((a) => a.id === id)!;
export function unavailableReason(id: AlgorithmId, level: LevelDefinition): string | null {
  return id === "bidirectional" && (level.board.terrain.includes("slow") || level.changes.some((c) => c.terrain === "slow")) ? "Butuh medan dengan biaya gerak seragam." : null;
}
export const BOT_COLORS = ["#329a15", "#208ba9", "#9964c2", "#cf7920"];
export interface MatchConfig {
  player: AlgorithmId;
  opponents: AlgorithmId[];
  seed: number;
}
export const defaultConfig = (seed: number): MatchConfig => ({ player: "astar", opponents: ["weighted-astar", "greedy"], seed });
