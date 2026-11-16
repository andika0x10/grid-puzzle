"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Header from "./Header";
import Icon from "./Icon";
import Modal from "./Modal";
import BoardCanvas from "./BoardCanvas";
import { getLevel, sections, levels, createGameDataProvider } from "../game/provider";
import { ReplayController } from "../game/replay";
import { emptyProgress, isLevelUnlocked, type DemoProgress } from "../game/progress";
import { initialFrame, mechanics } from "../game/mechanics";
import type { AttemptResult } from "../game/schema";
import { themes, spriteUrl } from "../game/themes";
const tierText = (r: AttemptResult) => (r.tier === "efficient" ? "Sangat efisien" : r.passed ? "Misi tercapai" : "Belum memenuhi misi");
const metricLabels: Record<string, string> = {
  work: "operasi",
  memory: "state",
  cost: "energi",
  quality: "cocok",
  groups: "grup",
};
export default function Game({ levelId }: { levelId: string }) {
  return <GameSession key={levelId} levelId={levelId} />;
}
function GameSession({ levelId }: { levelId: string }) {
  const level = getLevel(levelId)!;
  const theme = themes[level.theme];
  const provider = useMemo(() => createGameDataProvider(), []),
    controller = useMemo(() => new ReplayController(initialFrame(level)), [level]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [progress, setProgress] = useState<DemoProgress>(emptyProgress),
    [loaded, setLoaded] = useState(false),
    [storageWarning, setStorageWarning] = useState(false),
    [showTip, setShowTip] = useState(false);
  const request = useRef<AbortController | null>(null),
    requestSerial = useRef(0),
    playControl = useRef<HTMLButtonElement>(null);
  const section = sections.find((s) => s.id === level.sectionId)!,
    adapter = mechanics[level.mechanic];
  const unlocked = loaded && isLevelUnlocked(level.id, sections, progress),
    levelProgress = progress.levels[level.id];
  const active = level.options.find((o) => o.id === state.trace?.optionId),
    pending = level.options.find((o) => o.id === state.pending);
  const total = state.trace?.steps.length ?? 0,
    result = state.phase === "finished" ? state.trace?.result : null;
  const next = levels.find((l) => isLevelUnlocked(l.id, sections, progress) && !progress.levels[l.id]?.passed);
  useEffect(() => {
    setProgress(provider.getProgress());
    setLoaded(true);
    return () => {
      requestSerial.current++;
      request.current?.abort();
      controller.pause();
    };
  }, [provider, controller]);
  useEffect(() => {
    if (state.phase === "finished" && state.trace) {
      const saved = provider.completePlayback(state.trace);
      setProgress(saved.progress);
      setStorageWarning(!saved.persisted);
    }
  }, [state.phase, state.trace, provider]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("button,input,select,a,dialog,textarea") || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "Space" && state.trace) {
        e.preventDefault();
        state.phase === "playing" ? controller.pause() : controller.play();
      }
      if (e.key === "ArrowLeft" && state.trace) {
        e.preventDefault();
        controller.step(-1);
      }
      if (e.key === "ArrowRight" && state.trace) {
        e.preventDefault();
        controller.step(1);
      }
      if (/^[a-e]$/i.test(e.key) && unlocked) {
        const o = level.options[e.key.toLowerCase().charCodeAt(0) - 97];
        if (o) controller.choose(o.id);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [state.phase, state.trace, controller, level, unlocked]);
  async function confirm() {
    const current = controller.getSnapshot();
    if (current.phase !== "confirming" || !current.pending) return;
    const id = current.pending;
    controller.loading();
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const serial = ++requestSerial.current;
    try {
      const trace = await provider.startAttempt(level, id, abort.signal);
      if (serial === requestSerial.current && !abort.signal.aborted) {
        controller.load(trace);
        requestAnimationFrame(() => playControl.current?.focus());
      }
    } catch (e) {
      if (!abort.signal.aborted && serial === requestSerial.current) controller.fail(e instanceof Error ? e.message : "Rekaman belum termuat. Coba lagi.");
    }
  }
  if (!loaded)
    return (
      <>
        <Header compact />
        <main className="shell loading-page" role="status">
          <span className="loader" />
          Menyiapkan ekspedisi…
        </main>
      </>
    );
  if (!unlocked)
    return (
      <>
        <Header compact />
        <main className="locked-page shell">
          <span className="locked-illustration">
            <Icon name="lock" size={42} />
          </span>
          <h1>Ekspedisi ini belum terbuka.</h1>
          <p>Selesaikan level sebelumnya untuk melanjutkan perjalananmu.</p>
          <Link className="button primary" href="/">
            Lihat perjalanan
          </Link>
        </main>
      </>
    );
  const completedInSection = section.levelIds.filter((id) => progress.levels[id]?.passed).length;
  return (
    <div className="lesson-page">
      <header className="lesson-header">
        <div className="lesson-header-inner">
          <Link href="/" className="icon-button lesson-exit" aria-label="Kembali ke daftar level" title="Semua level">
            <Icon name="close" size={25} />
          </Link>
          <progress value={completedInSection} max={section.levelIds.length} aria-label={completedInSection + " dari " + section.levelIds.length + " level bagian ini selesai"} />
          <span className="lesson-count">
            Level <strong>{level.order}</strong> / {section.levelIds.length}
          </span>
        </div>
      </header>
      <main className="game shell">
        <div className="lesson-prompt">
          <div>
            <p className="lesson-topic">{level.title}</p>
            <h1>{level.mission}</h1>
          </div>
          <button className="icon-button" onClick={() => setShowTip(true)} aria-label="Lihat aturan medan">
            <Icon name="help" size={24} />
          </button>
        </div>
        <div className="game-layout">
          <div className="environment-column">
            <div className="environment-top">
              <span>{level.theme === "farm" ? "Kebun" : "Gurun"}</span>
              <span>
                {level.board.width} × {level.board.height} petak
              </span>
            </div>
            <BoardCanvas level={level} frame={state.frame} controller={controller} />
            <div className="board-legend">
              {state.trace ? (
                adapter.legend.map((item) => (
                  <span key={item.label}>
                    <i style={{ background: item.color }} />
                    {item.label}
                  </span>
                ))
              ) : (
                <>
                  <span>
                    <img src={spriteUrl(level.theme, "actor-down-idle-0")} width="32" height="32" alt="" />
                    {theme.actor}
                  </span>
                  <span>
                    <img src={spriteUrl(level.theme, level.mechanic === "navigation" ? "goal" : "crystal")} width="32" height="32" alt="" />
                    {level.mechanic === "navigation" ? "Tujuan" : theme.resource}
                  </span>
                </>
              )}
            </div>
            <div className="step-explanation" aria-live="polite">
              <p>{result?.reason ?? (state.trace ? state.frame.note : level.tip)}</p>
            </div>
            {state.phase === "error" && (
              <div className="feedback failed" role="alert">
                <strong>Rekaman belum dapat diputar.</strong>
                <p>{state.error}</p>
                <button className="button secondary" onClick={() => controller.choose(state.pending ?? active?.id ?? level.options[0].id)}>
                  Coba lagi
                </button>
              </div>
            )}
          </div>
          <aside className="choices-panel" aria-labelledby="choices-heading">
            <div className="choices-heading">
              <div>
                <h2 id="choices-heading">Pilih algoritma</h2>
                <p>Mana yang paling cocok untuk misi ini?</p>
              </div>
            </div>
            <div className="choices">
              {level.options.map((option, i) => {
                const saved = levelProgress?.results[option.id],
                  isActive = active?.id === option.id,
                  shown = isActive && state.trace ? state.frame.metrics : saved?.metrics,
                  doneActive = isActive && state.phase === "finished";
                return (
                  <button
                    key={option.id}
                    className={`choice ${isActive ? "active" : ""} ${saved?.passed ? "tried-success" : ""}`}
                    disabled={["playing", "loading", "confirming"].includes(state.phase)}
                    onClick={() => controller.choose(option.id)}
                    aria-label={`${String.fromCharCode(65 + i)}. ${option.name}. ${saved ? tierText(saved) : option.description}`}
                    aria-pressed={isActive}
                  >
                    <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                    <span className="choice-content">
                      <strong>{option.name}</strong>
                      {shown && (
                        <span className="choice-metrics">
                          {level.metrics.map((m) => (
                            <span key={m.id}>
                              <b>
                                {shown[m.id] ?? 0}
                                {m.unit === "%" ? "%" : ""}
                              </b>
                              <small>{metricLabels[m.id] ?? m.label.toLowerCase()}</small>
                            </span>
                          ))}
                        </span>
                      )}
                      {saved && (!isActive || doneActive) && (
                        <span className={`choice-result ${saved.passed ? "good" : "bad"}`}>
                          <Icon name={saved.passed ? "check" : "info"} size={12} />
                          {tierText(saved)}
                        </span>
                      )}
                      {isActive && state.phase === "playing" && (
                        <span className="choice-result live">
                          <span />
                          Sedang diamati
                        </span>
                      )}
                    </span>
                    {!shown && <span className="choice-radio" />}
                  </button>
                );
              })}
            </div>
            <p className="choice-hint">Pilih A–E. Kamu bisa mencoba lagi.</p>
            {state.trace && (
              <details className="metric-guide">
                <summary>Arti metrik</summary>
                {level.metrics.map((m) => (
                  <div key={m.id}>
                    <strong>
                      {m.label}
                      {m.required && m.limit !== undefined ? (
                        <span className="metric-limit">
                          {m.goal === "higher" ? "≥" : m.goal === "lower" ? "≤" : "="} {m.limit}
                          {m.unit === "%" ? "%" : ""}
                        </span>
                      ) : null}
                    </strong>
                    <p>{m.description}</p>
                  </div>
                ))}
              </details>
            )}
          </aside>
        </div>
        <p className="game-demo-note">Demo visual. Hasil menggunakan rekaman contoh.</p>
        {storageWarning && (
          <p className="error-text" role="alert">
            Progres belum tersimpan di browser. Kamu tetap dapat bermain selama halaman ini terbuka.
          </p>
        )}
      </main>
      <footer className={`lesson-dock ${result?.passed ? "dock-success" : ""}`}>
        <div className="lesson-dock-inner">
          {result && (
            <div className="dock-result" role="status">
              <span className="feedback-symbol">
                <Icon name={result.passed ? "check" : "info"} size={22} />
              </span>
              <h2>{tierText(result)}</h2>
              {levelProgress?.firstTry && result.passed && <span className="first-try">Percobaan pertama</span>}
              <button className="text-button" onClick={() => controller.play()}>
                <Icon name="reset" size={16} />
                Putar ulang
              </button>
            </div>
          )}
          {state.trace ? (
            <div className="playback">
              <div className="playback-top">
                <div className="playback-buttons">
                  <button
                    className="icon-button"
                    title="Ulang dari awal"
                    aria-label="Ulang dari awal"
                    disabled={!state.trace || state.phase === "loading"}
                    onClick={() => controller.seek(0)}
                  >
                    <Icon name="reset" size={18} />
                  </button>
                  <button
                    className="icon-button"
                    title="Langkah sebelumnya"
                    aria-label="Langkah sebelumnya"
                    disabled={!state.trace || state.cursor === 0 || state.phase === "loading"}
                    onClick={() => controller.step(-1)}
                  >
                    <Icon name="step-back" size={18} />
                  </button>
                  <button
                    ref={playControl}
                    className="play-button"
                    aria-label={state.phase === "playing" ? "Jeda simulasi" : "Putar simulasi"}
                    disabled={!state.trace || state.phase === "loading"}
                    onClick={() => (state.phase === "playing" ? controller.pause() : controller.play())}
                  >
                    <Icon name={state.phase === "playing" ? "pause" : "play"} size={19} />
                  </button>
                  <button
                    className="icon-button"
                    title="Langkah berikutnya"
                    aria-label="Langkah berikutnya"
                    disabled={!state.trace || state.cursor === total || state.phase === "loading"}
                    onClick={() => controller.step(1)}
                  >
                    <Icon name="step-next" size={18} />
                  </button>
                </div>
                <span className="step-counter">
                  <span className="counter-label">Langkah </span>
                  <strong>{state.cursor}</strong> / {total}
                </span>
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
              </div>
              <input
                className="timeline"
                type="range"
                min="0"
                max={Math.max(1, total)}
                value={state.cursor}
                disabled={!state.trace || state.phase === "loading"}
                aria-label="Langkah simulasi"
                aria-valuetext={`Langkah ${state.cursor} dari ${total}`}
                onChange={(e) => controller.seek(Number(e.target.value))}
              />
            </div>
          ) : (
            <p className="dock-hint">
              <Icon name="play" size={20} />
              Pilih algoritma untuk melihat cara kerjanya.
            </p>
          )}
          {result?.passed ? (
            next ? (
              <Link className="button primary dock-next" href={"/play/" + next.id}>
                Level berikutnya
              </Link>
            ) : (
              <Link className="button primary dock-next" href="/">
                Semua level selesai
              </Link>
            )
          ) : !state.trace ? (
            <button className="button secondary" onClick={() => setShowTip(true)}>
              Aturan medan
            </button>
          ) : null}
        </div>
      </footer>
      {pending && state.phase === "confirming" && (
        <Modal title={`Jalankan ${pending.name}?`} onClose={() => controller.cancel()}>
          <div className="confirm-actor">
            <img src={spriteUrl(level.theme, "actor-down-idle-0")} width="64" height="64" alt={`${theme.actor} siap bereksplorasi`} />
            <p>{pending.detail}</p>
          </div>
          <p className="modal-note">Amati rekaman langkahnya dan bandingkan hasilnya. Kamu bisa mencoba pilihan lain setelah simulasi selesai.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => controller.cancel()}>
              Pilih lagi
            </button>
            <button className="button primary" onClick={() => void confirm()}>
              <Icon name="play" size={16} />
              Jalankan
            </button>
          </div>
        </Modal>
      )}
      {state.phase === "loading" && (
        <div className="loading-toast" role="status">
          <span className="loader" />
          Memuat rekaman ekspedisi…
        </div>
      )}
      {showTip && (
        <Modal title="Kenali medannya" onClose={() => setShowTip(false)}>
          <p>{level.tip}</p>
          <div className="terrain-guide">
            {(level.mechanic === "navigation" ? theme.terrainGuide : theme.resourceGuide).map((item) => (
              <div key={item.asset}>
                <img src={spriteUrl(level.theme, item.asset)} width="32" height="32" alt="" />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <button className="button primary full" onClick={() => setShowTip(false)}>
            Mengerti
          </button>
        </Modal>
      )}
    </div>
  );
}
