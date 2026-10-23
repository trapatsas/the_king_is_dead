import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { sqliteCapturePlugin } from "./scripts/sqlite-plugin.mjs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), ...(process.env.VITEST ? [] : [sqliteCapturePlugin()])],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/.data/**",
        "**/artifacts/**",
        "**/ml/.venv/**",
        "**/dist-server/**",
      ],
    },
    fs: {
      deny: [
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/.data/**",
        "**/dist-server/**",
        "**/artifacts/**",
        "**/ml/.venv/**",
        "**/*.sqlite*",
        "**/*.db*",
        resolve(process.env.KING_DB_PATH ?? ".data/king.sqlite"),
        resolve((process.env.KING_DB_PATH ?? ".data/king.sqlite") + "-wal"),
        resolve((process.env.KING_DB_PATH ?? ".data/king.sqlite") + "-shm"),
        "**/*.pt",
      ],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
