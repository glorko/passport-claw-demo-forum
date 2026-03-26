import { defineConfig } from "vite";

/** Dev UI only; API runs in separate process (Crux tab: demo-forum-api). */
export default defineConfig({
  root: "web",
  server: {
    host: "127.0.0.1",
    port: 19173,
    strictPort: true,
  },
  envPrefix: "VITE_",
});
