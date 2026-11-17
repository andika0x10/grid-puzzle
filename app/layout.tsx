import type { Metadata } from "next";
import "./globals.css";
import SoundProvider from "../components/SoundProvider";

export const metadata: Metadata = {
  title: "Grid Puzzle — Arena petualang",
  icons: { icon: "/assets/game/characters/farm/portrait.png" },
  description: "Adu sepuluh algoritma dalam tujuh jenis game dan 49 level pixel art. Setiap pertandingan dihitung langsung saat Play.",
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
