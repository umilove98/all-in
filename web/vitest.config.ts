import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const dataDir = resolve(__dirname, "..", "data");

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@data": dataDir,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        inline: [],
      },
    },
  },
});
