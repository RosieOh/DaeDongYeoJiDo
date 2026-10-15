import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// BASE_PATH lets the GitHub Pages build serve from /<repository>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
});
