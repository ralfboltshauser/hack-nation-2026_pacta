import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^three$/,
        replacement: fileURLToPath(new URL("./node_modules/three/build/three.module.js", import.meta.url)),
      },
      {
        find: "three/addons",
        replacement: fileURLToPath(new URL("./node_modules/three/examples/jsm", import.meta.url)),
      },
    ],
  },
});
