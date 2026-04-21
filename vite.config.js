import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: "./src/admin",
  plugins: [vue()],
  base: "/admin/",
  build: {
    outDir: "../../dist/admin",
    emptyOutDir: true
  }
});