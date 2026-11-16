import Link from "next/link";
import Header from "../components/Header";
import Icon from "../components/Icon";
export default function NotFound() {
  return (
    <>
      <Header compact />
      <main className="locked-page shell">
        <span className="locked-illustration">
          <Icon name="flag" size={42} />
        </span>
        <h1>Jalur ini belum ada di peta.</h1>
        <p>Level yang kamu cari tidak ditemukan. Yuk, kembali ke perjalananmu.</p>
        <Link className="button primary" href="/">
          Kembali ke beranda
        </Link>
      </main>
    </>
  );
}
