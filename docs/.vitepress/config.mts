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
      {
        text: "設計",
        items: [
          { text: "v0.1 データモデル", link: "/design/v01-data-model" },
          { text: "権限カタログ", link: "/design/permission-catalog" },
        ],
      },
    ],
  },
});
