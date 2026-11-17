"use client";
import { useEffect, useRef, useState } from "react";
import { cellOf } from "../game/modes";
import type { LevelDefinition } from "../game/schema";
import type { MatchFrame } from "../game/engine";
import type { BoardRenderer } from "../game/renderer";
export default function BoardCanvas({
  level,
  frame,
  playing,
  focused,
  onReady,
}: {
  level: LevelDefinition;
  frame: MatchFrame;
  playing: boolean;
  focused: string;
  onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<BoardRenderer | null>(null),
    current = useRef({ frame, playing, focused, onReady });
  current.current = { frame, playing, focused, onReady };
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      instance: BoardRenderer | null = null;
    setStatus("loading");
    current.current.onReady(false);
    void import("../game/renderer")
      .then(async ({ BoardRenderer }) => {
        if (cancelled || !host.current) return;
        instance = new BoardRenderer(host.current, level, current.current.frame, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
        renderer.current = instance;
        await instance.ready();
        if (!cancelled) {
          instance.setFrame(current.current.frame);
          instance.setPlayback(current.current.playing);
          instance.setFocus(current.current.focused);
          setStatus("ready");
          current.current.onReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          current.current.onReady(false);
        }
      });
    return () => {
      cancelled = true;
      instance?.destroy();
      renderer.current = null;
    };
  }, [level, retry]);
  useEffect(() => {
    renderer.current?.setPlayback(playing);
    renderer.current?.setFrame(frame);
    renderer.current?.setFocus(focused);
  }, [frame, playing, focused]);
  const observed = frame.bots.find((b) => b.id === focused) ?? frame.bots[0];
  return (
    <div className="board-wrap">
      <div ref={host} className="canvas-host" role="img" aria-label="Papan permainan" />
      {status === "loading" && (
        <div className="board-cover" role="status">
          <span className="loader" />
          Menyiapkan arena…
        </div>
      )}
      {status === "error" && (
        <div className="board-cover" role="alert">
          <p>Arena belum dapat ditampilkan.</p>
          <button className="button secondary" onClick={() => setRetry((n) => n + 1)}>
            Muat ulang aset
          </button>
        </div>
      )}
      <p className="sr-only">
        Tick {frame.tick}. {level.mission}{" "}
        {frame.bots
          .filter((b) => level.mode !== "fog" || b.id === observed.id || observed.visible.includes(cellOf(b, level.board.width)))
          .map(
            (b) =>
              `${b.algorithm}: kolom ${b.x + 1}, baris ${b.y + 1}, skor ${b.score}, ${b.id === observed.id || level.mode !== "fog" ? b.detail : ""}${b.eliminatedTick !== null ? ", tereliminasi" : ""}`
          )
          .join(". ")}
      </p>
    </div>
  );
}
