import { defineConfig } from "vitepress";

export default defineConfig({
  title: "KIZAMI",
  description: "日本法準拠のセルフホスト勤怠管理OSS",
  lang: "ja",
  themeConfig: {
    nav: [{ text: "要件定義", link: "/requirements" }],
    sidebar: [
      {
        text: "プロジェクト",
        items: [{ text: "要件定義書", link: "/requirements" }],
      },
    ],
  },
});
