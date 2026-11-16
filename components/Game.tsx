"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import Icon from "./Icon";
import Header from "./Header";
import Modal from "./Modal";
import BoardCanvas from "./BoardCanvas";
import { getLevel, levels, sections } from "../game/provider";
import { algorithms, BOT_COLORS, getAlgorithm, unavailableReason, type AlgorithmId, type MatchConfig } from "../game/algorithms";
import { emptyProgress, isLevelUnlocked, readProgress, recordMatch, subscribeProgress } from "../game/progress";
import { SimulationController } from "../game/simulation";
import { themes } from "../game/themes";
import { TICK_MS, type BotStatus } from "../game/engine";

const statusText: Record<BotStatus, string> = { searching: "Mencari rute", moving: "Bergerak", finished: "Selesai", unreachable: "Jalan terputus", timeout: "Waktu habis" };
export default function Game({ levelId }: { levelId: string }) {
  return <GameSession key={levelId} levelId={levelId} />;
}
function GameSession({ levelId }: { levelId: string }) {
  const level = getLevel(levelId)!,
    theme = themes[level.theme],
    section = sections.find((s) => s.id === level.sectionId)!;
  const controller = useMemo(() => new SimulationController(level), [level]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [progress, setProgress] = useState(emptyProgress),
    [loaded, setLoaded] = useState(false),
    [boardReady, setBoardReady] = useState(false);
  const [panel, setPanel] = useState(false),
    [stats, setStats] = useState(false),
    [help, setHelp] = useState(false),
    [focused, setFocused] = useState("bot-0"),
    [storageWarning, setStorageWarning] = useState(false);
  const [draft, setDraft] = useState<MatchConfig>(state.config),
    [savedRun, setSavedRun] = useState(0);
  const recorded = useRef(0),
    playButton = useRef<HTMLButtonElement>(null);
  const unlocked = loaded && isLevelUnlocked(level.id, sections, progress),
    running = state.phase === "playing" || state.phase === "starting";
  const hasStarted = state.phase !== "ready",
    result = state.phase === "finished" ? state.result : null;
  const next = levels[levels.findIndex((l) => l.id === levelId) + 1];
  useEffect(() => {
    setProgress(readProgress());
    setLoaded(true);
    return subscribeProgress(() => setProgress(readProgress()));
  }, []);
  useEffect(() => {
    let raf = 0,
      last = performance.now();
    const frame = (now: number) => {
      controller.tick(now - last);
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const hidden = () => {
      if (document.hidden) controller.pause();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(raf);
      controller.dispose();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [controller]);
  useEffect(() => {
    if (!state.result || recorded.current === state.run) return;
    recorded.current = state.run;
    let cancelled = false;
    void recordMatch(level.id, level.mode, state.result).then((saved) => {
      if (!cancelled) {
        setProgress(saved.progress);
        setStorageWarning(!saved.persisted);
        setSavedRun(state.run);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.result, state.run, level.id, level.mode]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        !unlocked ||
        !boardReady ||
        document.querySelector("dialog[open]") ||
        (e.target as HTMLElement).closest("button,input,select,a,textarea,[contenteditable=true]") ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        running ? controller.pause() : controller.play();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        controller.step(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        controller.step(1);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [controller, unlocked, boardReady, running]);
  function openSettings() {
    controller.pause();
    setDraft(state.config);
    setPanel(true);
  }
  function start(config = state.config) {
    setPanel(false);
    setFocused("bot-0");
    controller.start(config);
    requestAnimationFrame(() => playButton.current?.focus({ preventScroll: true }));
  }
  function selectPlayer(id: AlgorithmId) {
    setDraft((old) => ({ ...old, player: id, opponents: old.opponents.includes(id) ? old.opponents.map((opponent) => (opponent === id ? old.player : opponent)) : old.opponents }));
  }
  function toggleOpponent(id: AlgorithmId) {
    setDraft((old) => ({ ...old, opponents: old.opponents.includes(id) ? old.opponents.filter((a) => a !== id) : [...old.opponents, id] }));
  }
  if (!loaded)
    return (
      <>
        <Header compact />
        <main className="locked-page shell" role="status">
          <span className="loader" />
          Menyiapkan perjalanan…
        </main>
      </>
    );
  if (!unlocked)
    return (
      <>
        <Header compact />
        <main className="locked-page shell">
          <Icon name="lock" size={42} />
          <h1>Arena ini belum terbuka.</h1>
          <p>Selesaikan pertandingan di level sebelumnya untuk melanjutkan.</p>
          <Link className="button primary" href="/">
            Lihat perjalanan
          </Link>
        </main>
      </>
    );
  const player = state.frame.bots.find((b) => b.player)!,
    observed = state.frame.bots.find((b) => b.id === focused) ?? player;
  const winners = state.frame.bots
    .filter((b) => state.frame.winners.includes(b.id))
    .map((b) => getAlgorithm(b.algorithm).short)
    .join(", ");
  const resultTitle = result?.won ? (result.draw ? "Hasil seri" : "Kamu menang!") : "Pertandingan selesai";
  return (
    <div className="match-page">
      <header className="match-header">
        <div className="match-header-inner">
          <Link href="/" className="icon-button" aria-label="Kembali ke daftar level">
            <Icon name="close" size={24} />
          </Link>
          <progress value={section.levelIds.filter((id) => progress.levels[id]?.completed).length} max={section.levelIds.length} aria-label="Progres kategori" />
          <span className="level-count">
            {level.order} / {section.levelIds.length}
          </span>
          <button
            className="icon-button"
            onClick={() => {
              controller.pause();
              setHelp(true);
            }}
            aria-label="Aturan arena"
          >
            <Icon name="help" />
          </button>
        </div>
      </header>
      <main className="match-main">
        <section className="arena-column" aria-label="Pertandingan">
          <div className="mission-row">
            <div>
              <p>{level.title}</p>
              <h1>{level.mission}</h1>
            </div>
            <button className="participants-button" onClick={openSettings} aria-label="Peserta">
              <Icon name="grid" size={17} />
              <span>Peserta</span>
            </button>
          </div>
          <div className="participant-strip" style={{ "--participants": state.frame.bots.length } as CSSProperties}>
            {state.frame.bots.map((bot, i) => (
              <button
                key={bot.id}
                className={`participant ${bot.id === focused ? "selected" : ""}`}
                style={{ "--bot-color": BOT_COLORS[i] } as CSSProperties}
                onClick={() => setFocused(bot.id)}
                aria-pressed={bot.id === focused}
                aria-label={`Amati ${getAlgorithm(bot.algorithm).name}${bot.player ? ", karakter saya" : ""}`}
              >
                <span className="participant-name">
                  <i>{i + 1}</i>
                  <strong>{getAlgorithm(bot.algorithm).short}</strong>
                </span>
                <span className="participant-score">
                  {hasStarted
                    ? level.mode === "gems"
                      ? `${bot.score} gem`
                      : `${(((bot.finishTick ?? state.frame.tick) * TICK_MS) / 1000).toFixed(1)} dtk`
                    : bot.player
                      ? "Kamu"
                      : "Lawan"}
                </span>
              </button>
            ))}
          </div>
          <div className="arena-meta">
            <span style={{ color: theme.color }}>
              <i style={{ background: theme.color }} />
              {theme.name}
            </span>
            <span>
              {hasStarted ? (
                <>
                  {state.phase === "paused" ? "Dijeda" : state.phase === "finished" ? "Selesai" : ""}
                  <b>{((state.frame.tick * TICK_MS) / 1000).toFixed(1)} dtk</b>
                </>
              ) : (
                `${level.board.width} × ${level.board.height} petak`
              )}
            </span>
          </div>
          <div
            className="arena-stage"
            style={
              { "--board-ratio": (level.board.width * 32 + 16) / (level.board.height * 32 + 16), "--board-max-width": `${level.board.width * 32 * 3 + 16}px` } as CSSProperties
            }
          >
            <div className="board-group">
              <BoardCanvas level={level} frame={state.frame} playing={state.phase === "playing"} focused={focused} onReady={setBoardReady} />
              <div className="arena-caption">
                <span>
                  <i className="visited-key" />
                  Diperiksa <i className="frontier-key" />
                  Kandidat
                </span>
                <p>
                  {state.phase === "ready"
                    ? "Pilih peserta atau langsung mulai."
                    : `${getAlgorithm(observed.algorithm).short}: ${statusText[observed.status].toLowerCase()} · ${observed.expanded} petak diperiksa`}
                </p>
              </div>
            </div>
          </div>
          <p className="sr-only" aria-live="polite">
            {state.frame.note}
          </p>
          {state.phase === "error" && (
            <div className="inline-error" role="alert">
              <p>{state.error}</p>
              <button className="text-button" onClick={() => start()}>
                Coba lagi
              </button>
            </div>
          )}
        </section>
      </main>
      <footer className="match-dock">
        {result && (
          <div className={`match-result ${result.won ? "won" : ""}`} role="status">
            <div>
              <strong>{resultTitle}</strong>
              <p>
                {winners ? `${winners} ${state.frame.winners.length > 1 ? "berbagi posisi teratas" : "menang"}.` : "Belum ada penjelajah yang mencapai finis."}{" "}
                {level.mode === "gems" ? `Kamu mendapat ${player.score} gem.` : ""}
              </p>
            </div>
            {savedRun === state.run && (
              <Link href={next ? `/play/${next.id}` : "/"} className="button primary next-level">
                {next ? "Level berikutnya" : "Semua level selesai"}
              </Link>
            )}
          </div>
        )}
        <div className="transport">
          {hasStarted && (
            <button
              className="icon-button"
              onClick={() => start()}
              disabled={!boardReady || !hasStarted || state.phase === "starting"}
              aria-label="Mulai ulang pertandingan"
              title="Mulai ulang"
            >
              <Icon name="reset" />
            </button>
          )}
          {hasStarted && (
            <button className="icon-button" onClick={() => controller.step(-1)} disabled={!state.cursor} aria-label="Langkah sebelumnya">
              <Icon name="step-back" />
            </button>
          )}
          <button
            ref={playButton}
            className={`play-button ${!hasStarted ? "start-button" : ""}`}
            disabled={!boardReady || state.phase === "starting"}
            onClick={() => (running ? controller.pause() : controller.play())}
            aria-label={
              state.phase === "playing"
                ? "Jeda pertandingan"
                : state.phase === "paused"
                  ? "Lanjutkan pertandingan"
                  : state.phase === "finished"
                    ? "Mulai ulang pertandingan"
                    : "Mulai pertandingan"
            }
          >
            <Icon name={state.phase === "playing" ? "pause" : "play"} size={23} />
            {!hasStarted && <span>Mulai</span>}
          </button>
          {hasStarted && (
            <button
              className="icon-button"
              onClick={() => controller.step(1)}
              disabled={!hasStarted || state.phase === "starting" || state.phase === "error" || state.frame.phase === "finished"}
              aria-label="Langkah berikutnya"
            >
              <Icon name="step-next" />
            </button>
          )}
          <label className="speed-label">
            <span className="sr-only">Kecepatan simulasi</span>
            <select value={state.speed} onChange={(e) => controller.setSpeed(Number(e.target.value))}>
              {[0.5, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString("id-ID")}×
                </option>
              ))}
            </select>
          </label>
          {hasStarted && (
            <button
              className="icon-button"
              onClick={() => {
                controller.pause();
                setStats(true);
              }}
              aria-label="Statistik dan riwayat"
              title="Statistik dan riwayat"
            >
              <Icon name="info" />
            </button>
          )}
        </div>
        {storageWarning && (
          <p className="storage-warning" role="alert">
            Progres belum tersimpan. Kamu tetap dapat bermain di tab ini.
          </p>
        )}
      </footer>
      {panel && (
        <Modal title="Pilih peserta" onClose={() => setPanel(false)}>
          <p className="modal-intro">Pilih algoritmamu dan satu sampai tiga lawan.</p>
          <Roster level={level} draft={draft} selectPlayer={selectPlayer} toggleOpponent={toggleOpponent} />
          <div className="modal-sticky-action">
            <button className="button primary full" disabled={!boardReady || draft.opponents.length < 1 || draft.opponents.length > 3} onClick={() => start(draft)}>
              <Icon name="play" size={17} />
              Mulai pertandingan
            </button>
          </div>
        </Modal>
      )}
      {stats && (
        <Modal title="Statistik pertandingan" onClose={() => setStats(false)}>
          <p className="modal-intro">Waktu finis = waktu mencari + perjalanan. 1 tick = 0,05 detik.</p>
          <div className="stat-table-wrap">
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Penjelajah</th>
                  <th>Petak</th>
                  <th>State</th>
                  <th>Biaya</th>
                  <th>Cari / gerak</th>
                </tr>
              </thead>
              <tbody>
                {state.frame.bots.map((b) => (
                  <tr key={b.id}>
                    <th>{getAlgorithm(b.algorithm).short}</th>
                    <td>{b.expanded}</td>
                    <td>{b.memory}</td>
                    <td>{b.cost}</td>
                    <td>
                      {(b.searchTicks * 0.05).toFixed(1)} / {(b.moveTicks * 0.05).toFixed(1)} dtk
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="history-label">
            Riwayat yang sudah dihitung{" "}
            <strong>
              Tick {state.cursor} / {state.head}
            </strong>
            <input
              className="timeline"
              type="range"
              min={0}
              max={Math.max(1, state.head)}
              value={state.cursor}
              disabled={!state.head}
              aria-label="Riwayat simulasi"
              onChange={(e) => controller.seek(Number(e.target.value))}
            />
          </label>
          <p className="modal-note">Petak = node diperiksa. State = puncak informasi pencarian tersimpan. Biaya = total medan yang dilalui.</p>
        </Modal>
      )}
      {help && (
        <Modal title={`Arena ${theme.name.toLowerCase()}`} onClose={() => setHelp(false)}>
          <p>
            {level.mode === "race"
              ? "Cari jalan lalu capai bendera finis. Penjelajah tercepat menang; waktu berpikir ikut dihitung."
              : "Rebut gem sebelum lawan. Gem yang dicapai pada tick yang sama memberi satu poin kepada setiap penjelajah yang tiba."}
          </p>
          <div className="terrain-guide">
            {(
              [
                ["ground", theme.ground],
                ["path", theme.path],
                ["slow", theme.slow],
                ["water", theme.water],
                ["wall", theme.wall],
                ["bridge-h", "Jembatan mendatar"],
                ["bridge-v", "Jembatan tegak"],
              ] as const
            ).map(([id, label]) => {
              const index = ["ground", "path", "slow", "water", "wall", "bridge-h", "bridge-v"].indexOf(id);
              return (
                <div key={id}>
                  <span className="terrain-swatch" style={{ backgroundImage: `url(/assets/game/themes/${level.theme}/atlas.png)`, backgroundPosition: `-${index * 32}px 0` }} />
                  <span>
                    {label}
                    <small>{id === "wall" || id === "water" ? "Tidak dapat dilalui" : id === "slow" ? "4 biaya gerak" : "1 biaya gerak"}</small>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="modal-note">Penjelajah tidak saling menghalangi. Menang atau kalah tetap membuka level berikutnya setelah pertandingan selesai.</p>
        </Modal>
      )}
    </div>
  );
}
function Roster({
  level,
  draft,
  selectPlayer,
  toggleOpponent,
}: {
  level: ReturnType<typeof getLevel> & {};
  draft: MatchConfig;
  selectPlayer: (id: AlgorithmId) => void;
  toggleOpponent: (id: AlgorithmId) => void;
}) {
  return (
    <div className="algorithm-list">
      {algorithms.map((algorithm) => {
        const reason = unavailableReason(algorithm.id, level),
          own = draft.player === algorithm.id,
          opponent = draft.opponents.includes(algorithm.id);
        return (
          <div key={algorithm.id} className="algorithm-entry">
            <div className="algorithm-name">
              <h3>{algorithm.name}</h3>
            </div>
            <p>{reason ?? algorithm.description}</p>
            <div className="algorithm-actions">
              <label>
                <input
                  type="radio"
                  name="player-algorithm"
                  checked={own}
                  disabled={!!reason}
                  onChange={() => selectPlayer(algorithm.id)}
                  aria-label={`Gunakan ${algorithm.name}`}
                />
                Saya
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={opponent}
                  disabled={!!reason || own || (!opponent && draft.opponents.length >= 3)}
                  onChange={() => toggleOpponent(algorithm.id)}
                  aria-label={`Lawan ${algorithm.name}`}
                />
                Lawan
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
