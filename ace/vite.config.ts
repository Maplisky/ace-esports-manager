import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // v1.0-13 发布准备：相对路径——GitHub Pages 项目页（/<repo>/ 子路径）/本地 file:// 均可加载
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.mimosa/**", "**/savedata/**"] },
  },
  worker: { format: "es" },
  build: { target: "es2023" },
});
