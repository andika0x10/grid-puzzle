"use client";
import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import Header from "./Header";
import Icon from "./Icon";
import Modal from "./Modal";
import { levels, sections } from "../game/provider";
import { emptyProgress, readProgress, resetProgress, isLevelUnlocked, subscribeProgress } from "../game/progress";
import { characterPortrait, themes } from "../game/themes";
export default function Home() {
  const [progress, setProgress] = useState(emptyProgress),
    [loaded, setLoaded] = useState(false),
    [help, setHelp] = useState(false),
    [reset, setReset] = useState(false),
    [storageError, setStorageError] = useState(false);
  useEffect(() => {
    setProgress(readProgress());
    setLoaded(true);
    return subscribeProgress(() => setProgress(readProgress()));
  }, []);
  const completed = levels.filter((l) => progress.levels[l.id]?.completed).length,
    next = levels.find((l) => isLevelUnlocked(l.id, sections, progress) && !progress.levels[l.id]?.completed);
  return (
    <>
      <Header completed={completed} total={levels.length} />
      <main className="home shell">
        <h1 className="sr-only">Perjalanan Grid Puzzle</h1>
        {sections.map((section) => {
          const done = section.levelIds.filter((id) => progress.levels[id]?.completed).length,
            locked = !isLevelUnlocked(section.levelIds[0], sections, progress);
          return (
            <section key={section.id} className={`journey-section ${locked ? "section-locked" : ""}`} aria-labelledby={`section-${section.id}`}>
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
                <button className="unit-guide" aria-label={`Panduan ${section.title}`} onClick={() => setHelp(true)}>
                  <Icon name="help" size={24} />
                </button>
              </div>
              <p className="unit-subtitle">{section.subtitle}</p>
              <ol className="path-stops">
                {section.levelIds.map((id, index) => {
                  const level = levels.find((l) => l.id === id)!,
                    theme = themes[level.theme],
                    entry = progress.levels[id],
                    unlocked = loaded && isLevelUnlocked(id, sections, progress),
                    current = next?.id === id;
                  const contents = (
                    <>
                      <span className="level-node">
                        {current && (
                          <span className="start-bubble" aria-hidden="true">
                            Mulai
                          </span>
                        )}
                        <img className="world-character" src={characterPortrait(level.theme)} width={56} height={56} alt="" />
                        <img className="world-prop" src={`/assets/game/themes/${level.theme}/decor.png`} width={36} height={36} alt="" />
                        {!unlocked && (
                          <span className="node-lock">
                            <Icon name="lock" size={14} />
                          </span>
                        )}
                      </span>
                      <span className="level-name">{level.title}</span>
                      <span className="level-theme">{theme.name}</span>
                    </>
                  );
                  return (
                    <li className="path-stop" key={id} style={{ "--path-offset": [0, -0.65, -1, -0.65, 0, 0.65, 1][index % 7] * (section.order % 2 ? 1 : -1) } as CSSProperties}>
                      {unlocked ? (
                        <Link
                          className={`level-link ${current ? "current" : ""}`}
                          href={`/play/${id}`}
                          aria-label={`Level ${index + 1} ${level.title}, ${theme.name}. ${entry?.completed ? "Selesai. Mainkan lagi" : "Mulai"}`}
                        >
                          {contents}
                        </Link>
                      ) : (
                        <div className="level-link is-locked" aria-disabled="true" aria-label={`${level.title}, terkunci`}>
                          {contents}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {locked && (
                <p className="section-unlock">
                  <Icon name="lock" size={14} />
                  Selesaikan kategori sebelumnya untuk membuka arena ini.
                </p>
              )}
            </section>
          );
        })}
        <footer className="home-footer">
          <div>
            <button className="text-button" onClick={() => setHelp(true)}>
              <Icon name="help" size={18} />
              Cara bermain
            </button>
            <button className="text-button" onClick={() => setReset(true)}>
              <Icon name="reset" size={16} />
              Ulang progres
            </button>
          </div>
          <p>Progres tersimpan di browser ini.</p>
          {storageError && (
            <p className="inline-error" role="alert">
              Progres belum tersimpan. Periksa izin penyimpanan browser.
            </p>
          )}
        </footer>
      </main>
      {help && (
        <Modal title="Cara bermain" onClose={() => setHelp(false)}>
          <ol className="help-steps">
            <li>
              <strong>Pilih algoritma dan lawannya.</strong>
              <p>Setiap algoritma punya cara mencari jalan yang berbeda. Kamu bisa mengatur hingga empat peserta.</p>
            </li>
            <li>
              <strong>Tekan Play dan amati.</strong>
              <p>Waktu mencari ikut dihitung. Sentuh peserta untuk melihat jejak pencariannya.</p>
            </li>
            <li>
              <strong>Coba lagi dengan strategi lain.</strong>
              <p>Menang atau kalah tetap membuka level berikutnya. Kejar kemenangan dan rekor baru.</p>
            </li>
          </ol>
          <button className="button primary full" onClick={() => setHelp(false)}>
            Mengerti
          </button>
        </Modal>
      )}
      {reset && (
        <Modal title="Ulang progres?" onClose={() => setReset(false)}>
          <p>Level selesai dan rekor di browser ini akan dikosongkan.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setReset(false)}>
              Batal
            </button>
            <button
              className="button primary"
              onClick={() => {
                const saved = resetProgress();
                setProgress(saved.progress);
                setStorageError(!saved.persisted);
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
