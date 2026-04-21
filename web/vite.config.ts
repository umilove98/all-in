import { defineConfig } from "vite";
import { resolve } from "node:path";

const dataDir = resolve(__dirname, "..", "data");
const assetsDir = resolve(__dirname, "..", "assets");

export default defineConfig({
  root: ".",
  // D:/all-in/assets 를 정적 에셋 디렉토리로 사용.
  // `assets/backgrounds/lobby.png` → `/backgrounds/lobby.png` 로 서빙.
  publicDir: assetsDir,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@data": dataDir,
      "@assets": assetsDir,
    },
  },
  server: {
    host: true,   // 0.0.0.0 바인딩 — 같은 네트워크의 다른 기기가 접속 가능
    port: 5173,
    fs: {
      // 프로젝트 루트(D:/all-in/web) 외부에 있는 data/·assets/ 디렉토리 접근 허용
      allow: ["..", dataDir, assetsDir],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
