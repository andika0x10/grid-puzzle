"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import Header from "./Header";
import Icon from "./Icon";
import Modal from "./Modal";
import { sections, levels, createGameDataProvider, resetDemoProgress } from "../game/provider";
import { emptyProgress, isLevelUnlocked, type DemoProgress } from "../game/progress";
import { spriteUrl } from "../game/themes";

export default function Home() {
  const [progress, setProgress] = useState<DemoProgress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [help, setHelp] = useState(false);
  const [reset, setReset] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setProgress(createGameDataProvider().getProgress());
    setLoaded(true);
  }, []);

  const completed = levels.filter((level) => progress.levels[level.id]?.passed).length;
  const next = levels.find((level) => isLevelUnlocked(level.id, sections, progress) && !progress.levels[level.id]?.passed);

  return (
    <>
      <Header completed={completed} total={levels.length} />
      <main className="home shell">
        <h1 className="sr-only">Pilih level Grid Puzzle</h1>
        <div className="sections">
          {sections.map((section, sectionIndex) => {
            const done = section.levelIds.filter((id) => progress.levels[id]?.passed).length;
            const locked = !isLevelUnlocked(section.levelIds[0], sections, progress);
            const theme = levels.find((l) => l.id === section.levelIds[0])!.theme;
            const curve = sectionIndex % 2 === 0 ? 1 : -1;

            return (
              <section className={`journey-section ${locked ? "section-locked" : ""}`} key={section.id} aria-labelledby={`section-${section.id}`}>
                <div className="unit-heading">
                  <div>
                    <p>
                      Bagian {section.order}
                      <span>
                        {done} dari {section.levelIds.length} selesai
                      </span>
                    </p>
                    <h2 id={`section-${section.id}`}>{section.title}</h2>
                  </div>
                  <button className="unit-guide" onClick={() => setHelp(true)} aria-label={`Panduan ${section.title}`}>
                    <Icon name="help" size={25} />
                  </button>
                </div>
                <p className="unit-subtitle">{section.subtitle}</p>

                <div className={`level-path path-${theme}`}>
                  <div className="path-character" aria-hidden="true">
                    <img src={spriteUrl(theme, "actor-down-idle-0")} width="96" height="96" alt="" />
                    <img className="path-prop" src={spriteUrl(theme, "tree")} width="64" height="64" alt="" />
                  </div>
                  <ol className="path-stops">
                    {section.levelIds.map((id, index) => {
                      const level = levels.find((entry) => entry.id === id)!;
                      const unlocked = loaded && isLevelUnlocked(id, sections, progress);
                      const passed = progress.levels[id]?.passed;
                      const current = next?.id === id;
                      const offset = [0, -0.65, -1, -0.65, 0][index % 5] * curve;
                      const contents = (
                        <>
                          <span className="level-node">
                            {current && (
                              <span className="start-bubble" aria-hidden="true">
                                Mulai
                              </span>
                            )}
                            <Icon name={passed ? "check" : !unlocked ? "lock" : index === section.levelIds.length - 1 ? "flag" : "star"} size={31} />
                          </span>
                          <span className="level-name">{level.title}</span>
                        </>
                      );
                      return (
                        <li className="path-stop" key={id} style={{ "--path-offset": offset } as CSSProperties}>
                          {unlocked ? (
                            <Link
                              href={`/play/${id}`}
                              className={`level-link ${current ? "current" : ""} ${passed ? "completed" : ""}`}
                              aria-label={`Level ${String(index + 1).padStart(2, "0")} ${level.title}. ${passed ? "Mainkan lagi" : "Mulai"}`}
                            >
                              {contents}
                            </Link>
                          ) : (
                            <div className="level-link is-locked" aria-disabled="true" aria-label={`${level.title}, terkunci. Selesaikan level sebelumnya.`}>
                              {contents}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                {locked && (
                  <p className="section-unlock">
                    <Icon name="lock" size={15} />
                    <span>Belum terbuka</span>
                    <span>Selesaikan bagian sebelumnya.</span>
                  </p>
                )}
              </section>
            );
          })}
        </div>
        <footer className="home-footer">
          <div className="home-footer-actions">
            <button className="text-button" onClick={() => setHelp(true)}>
              <Icon name="help" size={18} />
              Cara bermain
            </button>
            <button className="text-button" onClick={() => setReset(true)}>
              <Icon name="reset" size={16} />
              Ulang progres demo
            </button>
          </div>
          <p>Demo visual. Progres tersimpan di browser ini.</p>
          {storageError && (
            <p className="error-text" role="alert">
              Progres belum dapat disimpan. Periksa izin penyimpanan browser.
            </p>
          )}
        </footer>
      </main>

      {help && (
        <Modal title="Ekspedisi pertamamu" onClose={() => setHelp(false)}>
          <ol className="help-steps">
            <li>
              <strong>Baca misinya.</strong>
              <p>Perhatikan medan, tujuan, dan batas sumber daya.</p>
            </li>
            <li>
              <strong>Pilih satu algoritma.</strong>
              <p>Konfirmasi pilihan, lalu amati langkah-langkahnya.</p>
            </li>
            <li>
              <strong>Bandingkan dan coba lagi.</strong>
              <p>Hasil setiap pilihan tetap terlihat. Percobaan bebas.</p>
            </li>
          </ol>
          <p className="modal-note">Rekaman dan metrik pada demo ini adalah contoh visual.</p>
          <button className="button primary full" onClick={() => setHelp(false)}>
            Siap bereksplorasi
          </button>
        </Modal>
      )}
      {reset && (
        <Modal title="Ulang progres demo?" onClose={() => setReset(false)}>
          <p>Hasil percobaan dan level yang terbuka di browser ini akan dikosongkan.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setReset(false)}>
              Batal
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const result = resetDemoProgress();
                setStorageError(!result.persisted);
                setProgress(result.progress);
                setReset(false);
              }}
            >
              Ulang progres
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
