import type { LevelDefinition } from "./schema";
export const algorithms = [
  { id: "astar", name: "A*", short: "A*", description: "Seimbangkan biaya tindakan dan perkiraan menuju tujuan." },
  { id: "weighted-astar", name: "Weighted A*", short: "W·A*", description: "Kejar tujuan lebih agresif dengan bobot perkiraan 1,5." },
  { id: "greedy", name: "Greedy Best-First", short: "Greedy", description: "Utamakan keadaan yang terlihat dekat dengan tujuan." },
  { id: "dfs", name: "Depth-First Search", short: "DFS", description: "Telusuri satu cabang tindakan sebelum mencoba yang lain." },
  { id: "bidirectional", name: "Bidirectional BFS", short: "Bi-BFS", description: "Cari dari kedua arah pada navigasi dengan biaya seragam." },
  { id: "bfs", name: "Breadth-First Search", short: "BFS", description: "Minimalkan jumlah tindakan, bukan durasi atau energi." },
  { id: "dijkstra", name: "Dijkstra", short: "Dijkstra", description: "Cari biaya tindakan minimum dengan antrean bucket." },
  { id: "dstar-lite", name: "D* Lite", short: "D* Lite", description: "Gunakan kembali pencarian dan perbaiki state yang terdampak perubahan." },
  { id: "random", name: "Random Walk", short: "Random", description: "Langkah acak berbobot dengan memori eksplorasi, tujuan, dan keselamatan." },
  { id: "mcts", name: "Monte Carlo Tree Search", short: "MCTS", description: "Nilai tindakan melalui UCT dan simulasi aturan arena dengan rollout terarah." },
] as const;
export type AlgorithmId = (typeof algorithms)[number]["id"];
export const getAlgorithm = (id: AlgorithmId) => algorithms.find((a) => a.id === id)!;
export function unavailableReason(id: AlgorithmId, l: LevelDefinition): string | null {
  if (id !== "bidirectional") return null;
  if (l.mode !== "fog" && l.mode !== "hunt") return "Mode ini mempunyai tindakan berarah atau biaya berbeda; pencarian balik BFS tidak berlaku.";
  return l.board.terrain.includes("slow") ? "Butuh medan dengan biaya gerak seragam." : null;
}
export const BOT_COLORS = ["#329a15", "#208ba9", "#9964c2", "#cf7920"];
export interface MatchConfig {
  player: AlgorithmId;
  opponents: AlgorithmId[];
  seed: number;
}
export const defaultConfig = (seed: number): MatchConfig => ({ player: "astar", opponents: ["weighted-astar", "greedy"], seed });
