import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grid Puzzle — Petualangan kecil, logika besar",
  icons: { icon: "/assets/game/farm/sprites/actor-down-idle-0.png" },
  description: "Pilih algoritma, amati langkahnya, dan temukan pendekatan yang paling pas dalam petualangan pixel art.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
