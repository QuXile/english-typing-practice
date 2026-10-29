import { defineConfig } from "umi";

// GitHub Pages 项目站点部署在 /<repo>/ 下；本地开发仍使用根路径。
const isProduction = process.env.NODE_ENV === "production";
const base = isProduction ? "/english-typing-practice/" : "/";

export default defineConfig({
  title: "English Typing Practice",
  base,
  publicPath: base,
  outputPath: "docs",
  routes: [{ path: "/", component: "App" }],
  npmClient: "pnpm",
});
