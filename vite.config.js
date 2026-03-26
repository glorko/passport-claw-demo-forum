import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Dev: Vite only. Production: `npm run build` emits `web/dist` (both HTML entries) for the Node API to serve. */
export default defineConfig({
  root: "web",
  server: {
    host: "127.0.0.1",
    port: 19173,
    strictPort: true,
  },
  envPrefix: "VITE_",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "web/index.html"),
        "passport-local": path.resolve(__dirname, "web/passport-local.html"),
      },
    },
  },
});
