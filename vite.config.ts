import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // 版本号只维护 package.json（CI 会按 tag 改写它），界面里的版本由这里注入，避免写死后漂移
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        // 大依赖和 57 个预置插件源码单独成块，减小主包、并行加载
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("hls.js")) return "vendor-hls";
            if (id.includes("/react") || id.includes("react-dom")) return "vendor-react";
            return "vendor";
          }
          if (id.includes("bundled-plugins")) return "bundled-plugins";
        },
      },
    },
  },
});
