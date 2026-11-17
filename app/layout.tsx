import type { Metadata } from "next";
import "./globals.css";
import SoundProvider from "../components/SoundProvider";

export const metadata: Metadata = {
  title: "Grid Puzzle — Arena petualang",
  icons: { icon: "/assets/game/characters/farm/portrait.png" },
  description: "Adu 16 AI dalam 13 kategori dan 91 arena pixel art. Setiap pertandingan dihitung langsung saat Play.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <SoundProvider>{children}</SoundProvider>
      </body>
    </html>
  );
}
