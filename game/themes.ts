import type { LevelDefinition } from "./schema";

export type ThemeId = LevelDefinition["theme"];

// Terrain/object IDs describe game rules. Each biome supplies its own artwork and vocabulary.
export const themes = {
  farm: {
    actor: "Petani",
    resource: "Keranjang panen",
    terrainGuide: [
      { asset: "grass", label: "Rumput · 1 energi" },
      { asset: "path", label: "Jalan tanah · 1 energi" },
      { asset: "mud", label: "Tanah basah · 4 energi" },
      { asset: "water", label: "Saluran air · penghalang" },
      { asset: "wall", label: "Pagar tanaman · penghalang" },
      { asset: "bridge-h", label: "Jembatan · 1 energi" },
    ],
    resourceGuide: [
      { asset: "crystal", label: "Keranjang panen" },
      { asset: "bush", label: "Semak dekoratif" },
      { asset: "crate", label: "Peti hasil kebun" },
    ],
  },
  desert: {
    actor: "Sherif",
    resource: "Bijih emas",
    terrainGuide: [
      { asset: "grass", label: "Pasir · 1 energi" },
      { asset: "path", label: "Jalan setapak · 1 energi" },
      { asset: "mud", label: "Kerikil lepas · 4 energi" },
      { asset: "water", label: "Jurang · penghalang" },
      { asset: "wall", label: "Tebing · penghalang" },
      { asset: "bridge-h", label: "Jembatan tali · 1 energi" },
    ],
    resourceGuide: [
      { asset: "crystal", label: "Bijih emas" },
      { asset: "bush", label: "Semak gurun" },
      { asset: "crate", label: "Peti persediaan" },
    ],
  },
} as const;

export function spriteUrl(theme: ThemeId, name: string) {
  return `/assets/game/${theme}/sprites/${name}.png`;
}
