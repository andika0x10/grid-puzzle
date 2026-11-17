"use client";
import type { CSSProperties } from "react";
import Link from "next/link";
import { BOT_COLORS, getAlgorithm } from "../game/algorithms";
import type { MatchFrame } from "../game/engine";
import type { GameMode } from "../game/schema";
import { botMetricText, isRaceMode, modeInfo } from "../game/modes";
import Modal from "./Modal";
import Icon from "./Icon";

export function resultHeadline(frame: MatchFrame) {
  const winners = frame.bots.filter((b) => frame.winners.includes(b.id));
  if (!winners.length) return "Belum ada pemenang";
  if (winners.length > 1) return "Hasil seri";
  return `${getAlgorithm(winners[0].algorithm).name} menang!`;
}

export default function ResultDialog({
  frame,
  mode,
  onClose,
  onReplay,
  onSettings,
  nextHref,
  saved,
}: {
  frame: MatchFrame;
  mode: GameMode;
  onClose: () => void;
  onReplay: () => void;
  onSettings: () => void;
  nextHref: string | null;
  saved: boolean;
}) {
  const player = frame.bots.find((b) => b.player)!;
  const winners = frame.bots.filter((b) => frame.winners.includes(b.id));
  const playerWon = frame.winners.includes(player.id);
  const winnerNames = winners.map((b) => getAlgorithm(b.algorithm).name).join(" dan ");
  const ordered = [...frame.bots].sort(
    (a, b) =>
      Number(frame.winners.includes(b.id)) - Number(frame.winners.includes(a.id)) ||
      (isRaceMode(mode)
        ? (a.finishTick ?? Infinity) - (b.finishTick ?? Infinity)
        : mode === "collapse"
          ? (b.eliminatedTick ?? frame.tick) - (a.eliminatedTick ?? frame.tick)
          : b.score - a.score)
  );
  const outcome =
    winners.length === 0
      ? isRaceMode(mode)
        ? "Tidak ada bot yang mencapai finis."
        : `Belum ada ${modeInfo[mode].unit} yang diperoleh.`
      : winners.length > 1
        ? `${winnerNames} berbagi kemenangan.${playerWon ? " Bot kamu ikut menang." : ""}`
        : playerWon
          ? "Bot kamu memenangkan pertandingan!"
          : "Bot lawan memenangkan pertandingan.";
  return (
    <Modal title={resultHeadline(frame)} onClose={onClose} className="result-dialog">
      <div className={`result-summary ${playerWon ? "player-won" : ""}`}>
        <span className="result-emblem">
          <Icon name="flag" size={30} />
        </span>
        <div>
          <p className="result-outcome">{outcome}</p>
          <p className="result-player">Bot kamu menggunakan {getAlgorithm(player.algorithm).name}.</p>
        </div>
      </div>
      <ul className="result-standings" aria-label="Hasil peserta">
        {ordered.map((bot) => {
          const index = frame.bots.findIndex((b) => b.id === bot.id),
            won = frame.winners.includes(bot.id);
          return (
            <li key={bot.id} className={`result-standing ${won ? "winner" : ""}`} style={{ "--bot-color": BOT_COLORS[index] } as CSSProperties}>
              <span className="result-bot-number" aria-label={`Bot ${index + 1}`}>
                {index + 1}
              </span>
              <div className="result-bot-name">
                <strong>{getAlgorithm(bot.algorithm).name}</strong>
                <span>
                  {bot.player ? "Bot kamu" : "Lawan"}
                  {won ? " · Pemenang" : ""}
                </span>
              </div>
              <b className="result-value">{botMetricText(mode, bot, frame.tick, true)}</b>
            </li>
          );
        })}
      </ul>
      <div className="result-actions">
        {saved ? (
          <Link href={nextHref ?? "/"} className="button primary full">
            {nextHref ? "Level berikutnya" : "Kembali ke daftar level"}
          </Link>
        ) : (
          <button className="button primary full" disabled>
            Menyimpan progres…
          </button>
        )}
        <div>
          <button className="button secondary" onClick={onReplay}>
            Main lagi
          </button>
          <button className="button secondary" onClick={onSettings}>
            Ganti algoritma
          </button>
        </div>
      </div>
    </Modal>
  );
}
