import type { LevelDefinition } from "./schema";
export const algorithms = [
  { id: "astar", name: "A*", short: "A*", description: "Seimbangkan biaya rute dan perkiraan jarak." },
  { id: "weighted-astar", name: "Weighted A*", short: "W·A*", description: "Kejar tujuan lebih agresif. Rutenya bisa lebih mahal." },
  { id: "greedy", name: "Greedy Best-First", short: "Greedy", description: "Dahulukan yang terlihat dekat. Waspadai jalan buntu." },
  { id: "dfs", name: "Depth-First Search", short: "DFS", description: "Terobos satu cabang. Bisa menang besar kalau jalurnya tepat." },
  { id: "bidirectional", name: "Bidirectional BFS", short: "Bi-BFS", description: "Cari dari start dan target sekaligus sampai bertemu." },
  { id: "bfs", name: "Breadth-First Search", short: "BFS", description: "Jelajahi selapis demi selapis. Utamakan jumlah langkah, bukan biaya medan." },
  { id: "dijkstra", name: "Dijkstra", short: "Dijkstra", description: "Pilih biaya perjalanan terkecil tanpa perkiraan jarak." },
  { id: "dstar-lite", name: "D* Lite", short: "D* Lite", description: "Simpan hasil pencarian dan perbaiki rute ketika medan berubah." },
  { id: "random", name: "Random Walk", short: "Random", description: "Pilih langkah acak. Hindari langsung kembali jika ada jalan lain." },
  { id: "mcts", name: "Monte Carlo Tree Search", short: "MCTS", description: "Coba kemungkinan tindakan melalui simulasi, lalu pilih yang menjanjikan." },
] as const;
if (new Set(algorithms.map((a) => a.id)).size !== algorithms.length) throw new Error("Katalog algoritma harus unik.");
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
