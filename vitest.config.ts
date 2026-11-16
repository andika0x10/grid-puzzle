import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "next/link": fileURLToPath(new URL("./tests/link.tsx", import.meta.url)) } },
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
