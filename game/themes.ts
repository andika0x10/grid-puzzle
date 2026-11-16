export const themeIds = ["farm", "desert", "forest", "snow", "volcano", "factory", "space"] as const;
export type ThemeId = (typeof themeIds)[number];
export const themes = {
  farm: { name: "Kebun", color: "#59923d", ground: "Rumput", path: "Jalan tanah", slow: "Lumpur", water: "Saluran air", wall: "Pagar tanaman" },
  desert: { name: "Gurun", color: "#b4772c", ground: "Pasir", path: "Jalan setapak", slow: "Kerikil lepas", water: "Jurang", wall: "Tebing" },
  forest: { name: "Hutan", color: "#35735f", ground: "Tanah berlumut", path: "Jalur hutan", slow: "Lumpur berakar", water: "Sungai", wall: "Pohon rapat" },
  snow: { name: "Salju", color: "#527c9a", ground: "Salju", path: "Jalur padat", slow: "Salju tebal", water: "Retakan es", wall: "Tebing es" },
  volcano: { name: "Vulkanik", color: "#b65532", ground: "Basalt", path: "Jalur obsidian", slow: "Abu tebal", water: "Lava", wall: "Batu vulkanik" },
  factory: { name: "Pabrik", color: "#587c89", ground: "Lantai logam", path: "Lorong", slow: "Tumpahan oli", water: "Celah lantai", wall: "Mesin" },
  space: { name: "Luar angkasa", color: "#7460a7", ground: "Debu bulan", path: "Platform", slow: "Puing", water: "Ruang kosong", wall: "Meteor" },
} satisfies Record<ThemeId, { name: string; color: string; ground: string; path: string; slow: string; water: string; wall: string }>;
export const characterPortrait = (theme: ThemeId) => `/assets/game/characters/${theme}/portrait.png`;
