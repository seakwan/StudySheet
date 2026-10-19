import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
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
});
