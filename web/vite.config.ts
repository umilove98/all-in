import { defineConfig } from "vite";
import { resolve } from "node:path";

const dataDir = resolve(__dirname, "..", "data");

export default defineConfig({
  root: ".",
  // 디자인 핸드오프 번들의 에셋(lobby.png / gameboard.png)을 web/public 에 둬서 서빙.
  // `public/backgrounds/lobby.png` → `/backgrounds/lobby.png` 로 서빙.
  publicDir: "public",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@data": dataDir,
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      // data/ 는 프로젝트 루트 외부라 명시적 허용 필요
      allow: ["..", dataDir],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
