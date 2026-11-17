import { layouts } from "./arena-layouts";
import { gameModes, levelSchema, isWalkable, type GameMode, type Point, type Terrain } from "../game/schema";
import { themeIds } from "../game/themes";
import { modeInfo } from "../game/modes";
const names: Record<GameMode, string[]> = {
  fog: ["Simpang pertama", "Ruang tersembunyi", "Ujung yang menipu", "Cincin terputus", "Pintu rimba", "Sektor tak terlihat", "Jejak di kehampaan"],
  collapse: ["Pijakan pertama", "Putaran retak", "Empat pelarian", "Jembatan pijakan", "Cincin bara", "Ruang yang hilang", "Evakuasi orbit"],
  hunt: ["Potong putaran", "Arah berlawanan", "Dua buruan", "Persilangan salju", "Pintas kawah", "Tiga lintasan", "Pencegat orbit"],
  circuit: ["Sambungan pertama", "Dua aliran", "Akses silang", "Tiga ruangan", "Jalur balik", "Empat saklar", "Jaringan orbital"],
  energy: ["Isi sebelum pergi", "Dua stasiun", "Harga jalan pintas", "Antrean pengisian", "Suar terpencar", "Rantai pasokan", "Ekspedisi terakhir"],
  bridge: ["Bentang pertama", "Pilih penyeberangan", "Tiga pulau", "Bahan di seberang", "Jalur silang", "Pembangun cepat", "Lima sambungan"],
  crates: ["Dorong ke tanda", "Putar sebelum dorong", "Dua kiriman", "Ruang manuver", "Kosongkan jalur", "Urutan tiga peti", "Susunan terakhir"],
};
const missions: Record<GameMode, string> = {
  fog: "Ungkap labirin dan capai keluar.",
  collapse: "Cari pijakan dan bertahan paling lama.",
  hunt: "Cegat target, rebut poin terbanyak.",
  circuit: "Sambung listrik, klaim terminal.",
  energy: "Isi energi dan aktifkan suar.",
  bridge: "Bangun jalan, rebut pulau, capai keluar.",
  crates: "Dorong peti bersama ke tujuannya.",
};
const briefings: Record<GameMode, string> = {
  fog: "Pintu keluar ditandai, tetapi jalannya belum diketahui. Pemindai membuka dua petak di sekitarmu; tiap bot menyimpan pengetahuan sendiri.",
  collapse: "Retakan dari bot lain ikut memutus jalanmu. Perhatikan hitung mundur dan sisakan beberapa jalur pelarian sebelum gelombang berikutnya.",
  hunt: "Mengekor belum tentu cepat. Perkirakan titik pertemuan dari lintasan dan arah target. Satu target hanya memberi poin kepada satu bot.",
  circuit: "Pola di panel menunjukkan sambungan yang dibutuhkan. Setiap saklar juga mengubah akses bersama; rencanakan jalan ke terminal sebelum mengklaimnya.",
  energy: "Jalan singkat bisa menguras baterai. Sisakan lima energi untuk suar dan rencanakan kunjungan ke stasiun yang stoknya dipakai bersama.",
  bridge: "Pembuat jembatan mendapat poin, penjelajah lain mendapat akses. Bandingkan keuntungan membangun, merebut penanda pulau, dan mengejar bonus keluar.",
  crates: "Peti yang masuk tujuan terkunci dan memberi poin kepada pendorong. Sisakan tempat berdiri di belakang peti; satu dorongan bisa mengubah rencana seluruh peserta.",
};
export function authorLevels() {
  return gameModes.flatMap((mode, mi) =>
    themeIds.map((theme, index) => {
      const rows = layouts[mode][index].split("\n"),
        width = Math.max(...rows.map((r) => r.length)),
        height = rows.length;
      const grid = rows.map((r) => r.padEnd(width, "#"));
      const points = (char: string): Point[] => grid.flatMap((row, y) => [...row].flatMap((c, x) => (c === char ? [{ x, y }] : [])));
      const terrain: Terrain[] = grid.flatMap((row) => [...row].map((c) => (c === "#" ? "wall" : c === "~" || (mode === "bridge" && /\d/.test(c)) ? "water" : "ground")));
      const spawn = points("S")[0],
        goal = points("G")[0];
      if (!spawn) throw new Error(`No spawn ${mode}-${index + 1}`);
      // Weight belongs to terrain, never to a particular algorithm. Preserve four
      // uniform levels for modes supporting bidirectional navigation.
      if ([2, 4, 6].includes(index) && mode !== "crates")
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (grid[y][x] === "." && (x * 3 + y * 5 + mi) % 13 === 0) terrain[y * width + x] = "slow";
      terrain[spawn.y * width + spawn.x] = "path";
      const extras: Record<string, unknown> = {};
      if (mode === "fog") extras.fog = { radius: 2 };
      if (mode === "collapse") {
        const rank = (x: number, y: number) =>
          index === 0
            ? y
            : index === 1
              ? x
              : index === 2
                ? x + y
                : index === 3
                  ? Math.max(Math.abs(x - width / 2), Math.abs(y - height / 2))
                  : index === 4
                    ? width - x + y
                    : index === 5
                      ? Math.floor(x / 4) * 3 + (y % 3)
                      : Math.abs(x - width / 2) + height - y;
        const cells = terrain.flatMap((t, c) => (t !== "wall" ? [{ x: c % width, y: Math.floor(c / width), rank: rank(c % width, Math.floor(c / width)) }] : [])),
          ranks = cells.map((c) => c.rank),
          min = Math.min(...ranks),
          max = Math.max(...ranks),
          groups = new Map<number, Point[]>();
        for (const { x, y, rank: r } of cells) {
          const bucket = Math.min(8, Math.floor(((r - min) / Math.max(1, max - min)) * 8)),
            tick = 160 + bucket * 120;
          const group = groups.get(tick) ?? [];
          group.push({ x, y });
          groups.set(tick, group);
        }
        extras.collapse = { graceTicks: 160, trailTicks: 24, waves: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([tick, cells]) => ({ tick, cells })) };
      }
      if (mode === "hunt") {
        const targets = ["r", "u", "v"].flatMap((symbol, i) => {
          const ps = points(symbol);
          if (!ps.length) return [];
          const allowed = new Set(ps.map((p) => p.y * width + p.x));
          const route: Point[] = [];
          let prev = -1,
            current = ps[0].y * width + ps[0].x;
          do {
            route.push({ x: current % width, y: Math.floor(current / width) });
            const ns = [current + 1, current - width, current - 1, current + width].filter((n) => allowed.has(n));
            if (ns.length !== 2) throw new Error(`Target cycle ${mode}-${index + 1}/${symbol} at ${current}: ${ns}`);
            const next = ns.find((n) => n !== prev)!;
            prev = current;
            current = next;
            if (route.length > ps.length) throw new Error("Broken cycle");
          } while (current !== ps[0].y * width + ps[0].x);
          if (route.length !== ps.length) throw new Error("Disconnected target cycle");
          return [{ route, stepTicks: 8 + (i % 2) * 2 }];
        });
        extras.hunt = { targets, respawnTicks: 20 };
      }
      if (mode === "circuit") {
        const switches = ["a", "b", "c", "d"].flatMap((char, i) => points(char).map((p) => ({ ...p, gates: points(String(i)) })));
        const terminals = points("T");
        extras.circuit = {
          switches,
          initialMask: 0,
          contracts: Array.from({ length: 3 + Math.floor((index * 2) / 3) }, (_, i) => ({
            ...terminals[i % terminals.length],
            mask: [1, 3, 2, 6, 4, 12, 8, 0][i % 8] % 2 ** switches.length,
          })),
        };
      }
      if (mode === "energy") extras.energy = { capacity: 24, chargers: points("C"), beacons: points("E") };
      if (mode === "bridge") {
        const spans = ["1", "2", "3", "4", "5"].flatMap((char) => {
          const cells = points(char);
          if (!cells.length) return [];
          const first = cells[0],
            last = cells.at(-1)!;
          const horizontal = cells.length > 1 ? first.y === last.y : isWalkable(terrain[first.y * width + first.x - 1]) && isWalkable(terrain[first.y * width + first.x + 1]);
          return [
            {
              banks: horizontal
                ? [
                    { x: first.x - 1, y: first.y },
                    { x: last.x + 1, y: last.y },
                  ]
                : [
                    { x: first.x, y: first.y - 1 },
                    { x: last.x, y: last.y + 1 },
                  ],
              cells,
            },
          ];
        });
        extras.bridge = { spans, supplies: points("P"), markers: points("M") };
      }
      if (mode === "crates") extras.crates = { boxes: points("B"), docks: points("D") };
      return levelSchema.parse({
        schemaVersion: 4,
        rulesVersion: 4,
        id: `${mode}-${index + 1}`,
        sectionId: mode,
        order: index + 1,
        title: names[mode][index],
        mission: missions[mode],
        briefing: briefings[mode],
        theme,
        mode,
        seed: 41001 + mi * 1000 + index,
        timeLimit: 1200,
        board: {
          width,
          height,
          terrain,
          spawn,
          ...(goal ? { goal } : {}),
          decorations: [
            { x: 0, y: 0 },
            { x: width - 1, y: height - 1 },
          ],
        },
        ...extras,
      });
    })
  );
}
export const sections = gameModes.map((id, i) => ({ id, order: i + 1, title: modeInfo[id].title, subtitle: missions[id], levelIds: themeIds.map((_, j) => `${id}-${j + 1}`) }));
