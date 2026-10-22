import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages 把项目站点发布在 /<repo>/ 子路径下，绝对路径 "/" 会让资源 404。
  // 构建产物改用相对路径后，换仓库名、放自定义域名、甚至直接打开 dist 都不用再改配置；
  // 本地 dev 仍然用绝对路径 "/"。
  base: command === "build" ? "./" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "node",
    // 统计逻辑按本地时区归属自然日，测试必须固定时区才可复现
    env: { TZ: "Asia/Shanghai" },
  },
}));
