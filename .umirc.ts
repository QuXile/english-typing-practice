import { defineConfig } from "umi";

export default defineConfig({
  title: "English Typing Practice",
  outputPath: 'docs',
  routes: [
    { path: "/", component: "App" }
  ],
  npmClient: 'pnpm',
});
