import Link from "next/link";
import Icon from "./Icon";
import SoundButton from "./SoundButton";
export default function Header({ compact = false, completed, total = 14 }: { compact?: boolean; completed?: number; total?: number }) {
  return (
    <header className={`site-header ${compact ? "compact-header" : ""}`}>
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="Grid Puzzle, beranda">
          Grid Puzzle
        </Link>
        <div className="header-actions">
          {compact ? (
            <Link className="header-link" href="/">
              <Icon name="grid" size={18} />
              Semua level
            </Link>
          ) : completed !== undefined ? (
            <div className="header-progress">
              <span>
                <strong>{completed}</strong> / {total} level
              </span>
              <progress value={completed} max={total} aria-label={`${completed} dari ${total} level selesai`} />
            </div>
          ) : (
            <span className="header-label">Arena petualang</span>
          )}
          <SoundButton />
        </div>
      </div>
    </header>
  );
}
