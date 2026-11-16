import type { BoardState, LevelDefinition, MechanicId } from "./schema";
import { themes } from "./themes";
export const GROUP_COLORS = ["#58a9b7", "#ae88ca", "#e5ad43", "#eb8c82", "#84a963"];
export interface MechanicAdapter {
  label: string;
  legend: { label: string; color: string }[];
  describe(level: LevelDefinition, frame: BoardState): string;
}
export const mechanics: Record<MechanicId, MechanicAdapter> = {
  navigation: {
    label: "Navigasi",
    legend: [
      { label: "Diperiksa", color: "#b8d9af" },
      { label: "Antrean", color: "#eacb7b" },
      { label: "Rute", color: "#57a4b2" },
    ],
    describe: (l, f) =>
      `Papan ${l.board.width} kali ${l.board.height}. ${themes[l.theme].actor} di kolom ${(f.entities.robot?.x ?? l.board.robot?.x ?? 0) + 1}, baris ${(f.entities.robot?.y ?? l.board.robot?.y ?? 0) + 1}. ${f.note}`,
  },
  clustering: {
    label: "Pengelompokan sumber daya",
    legend: [
      { label: "Kelompok 1", color: GROUP_COLORS[0] },
      { label: "Kelompok 2", color: GROUP_COLORS[1] },
      { label: "Kelompok 3", color: GROUP_COLORS[2] },
      { label: "Pencilan", color: "#a4a7a2" },
    ],
    describe: (l, f) =>
      `${l.board.objects.filter((o) => o.asset === "crystal").length} titik ${themes[l.theme].resource.toLowerCase()} pada papan ${l.board.width} kali ${l.board.height}. ${f.note}`,
  },
};
export function initialFrame(level: LevelDefinition): BoardState {
  return {
    cells: {},
    entities: level.board.robot ? { robot: { ...level.board.robot, facing: "down" } } : {},
    path: [],
    centroids: [],
    metrics: Object.fromEntries(level.metrics.map((m) => [m.id, 0])),
    note: "Pilih sebuah algoritma untuk memulai ekspedisi.",
  };
}
