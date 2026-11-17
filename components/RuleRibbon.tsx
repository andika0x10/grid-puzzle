import type { LevelDefinition } from "../game/schema";
import type { MatchFrame } from "../game/engine";
export default function RuleRibbon({ level, frame, focused }: { level: LevelDefinition; frame: MatchFrame; focused?: string }) {
  const bot = frame.bots.find((b) => b.id === focused) ?? frame.bots.find((b) => b.player)!,
    s = frame.modeState;
  let primary = "",
    secondary = "",
    progress: number | undefined,
    max = 1;
  if (level.mode === "fog") {
    primary = `${bot.known.filter(Boolean).length} petak terungkap`;
    secondary = "Pemindai radius 2 · pengetahuan pribadi";
    progress = bot.known.filter(Boolean).length;
    max = level.board.terrain.length;
  }
  if (level.mode === "collapse" && s.mode === "collapse") {
    const next = Math.min(...s.dangerAt.filter((t) => t > frame.tick));
    primary = Number.isFinite(next) ? `Runtuh berikutnya ${Math.max(0, (next - frame.tick) / 20).toFixed(1)} dtk` : "Pijakan terakhir";
    secondary = `${frame.bots.filter((b) => b.eliminatedTick === null).length} penjelajah bertahan · jejak runtuh 1,2 dtk`;
  }
  if (level.mode === "hunt" && s.mode === "hunt") {
    primary = `${s.targets.filter((t) => t.active).length} target bergerak`;
    secondary = "Tangkap +1 · muncul kembali 1 dtk";
  }
  if (level.mode === "circuit" && s.mode === "circuit") {
    const contract = level.circuit.contracts[s.contract];
    primary = contract ? `Kontrak ${s.contract + 1}/${level.circuit.contracts.length}` : "Semua kontrak selesai";
    secondary = contract
      ? `Pola ${level.circuit.switches.map((_, i) => `${i + 1}:${contract.mask & (1 << i) ? "on" : "off"}`).join("  ")} · klaim +3`
      : "Sambungan terakhir selesai";
  }
  if (level.mode === "energy" && s.mode === "energy") {
    primary = `Energi ${bot.energy}/24`;
    secondary = `${s.owners.filter(Boolean).length}/${s.owners.length} suar aktif · aktivasi 5 energi`;
    progress = bot.energy;
    max = 24;
  }
  if (level.mode === "bridge" && s.mode === "bridge") {
    primary = `Bahan ${bot.inventory}/3`;
    secondary = `${s.builders.filter(Boolean).length}/${s.builders.length} jembatan · bangun +2, pulau +3, keluar +5`;
    progress = bot.inventory;
    max = 3;
  }
  if (level.mode === "crates" && s.mode === "crates") {
    primary = `${s.boxes.filter((b) => b.owner).length}/${s.boxes.length} peti terkunci`;
    secondary = "Peti bersama · satu poin untuk pendorong";
    progress = s.boxes.filter((b) => b.owner).length;
    max = s.boxes.length;
  }
  if (s.mode === "bomb") {
    primary = `${s.bombs.length} bom · sumbu ${((level.mode === "bomb" ? level.bomb.fuseTicks : 36) / 20).toFixed(1)} dtk`;
    secondary = "Bot terakhir menang · selain itu: skor tertinggi";
  }
  if (s.mode === "snake") {
    primary = `Panjang ekor ${(s.tails[bot.id]?.length ?? 0) + 1}`;
    secondary = "Bot terakhir menang · waktu habis: buah terbanyak";
  }
  if (s.mode === "flow") {
    primary = `${s.owners.filter(Boolean).length}/${s.owners.length} token direbut`;
    secondary = "Panah memaksa gerak · es meluncur · token +2";
  }
  if (s.mode === "portal") {
    primary = `Jaringan portal ${s.phase + 1}`;
    secondary = "Nomor kecil: identitas · nomor tengah: tujuan · jaringan bergeser tiap pemakaian";
  }
  if (s.mode === "tactical") {
    primary = `${s.walls.filter((p) => p.owner === bot.id).length}/3 pagar terpasang`;
    secondary = "Pagar bertahan 5 dtk · seluruh objektif harus tetap terhubung";
  }
  if (s.mode === "stealth") {
    primary = `Terdeteksi ${((s.alert[bot.id] ?? 0) / 20).toFixed(1)}/1 dtk`;
    secondary = "Semak menyembunyikan · pengalih perhatian menghentikan patroli";
    progress = s.alert[bot.id] ?? 0;
    max = 20;
  }
  return (
    <div className={`rule-ribbon mode-${level.mode}`} aria-label="Aturan dan status arena">
      <span>
        <strong>{primary}</strong>
        <small>{secondary}</small>
      </span>
      {progress !== undefined && <progress value={progress} max={max} aria-label="Status objektif" />}
    </div>
  );
}
