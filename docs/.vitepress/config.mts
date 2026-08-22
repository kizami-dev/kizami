import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { collectEntries } from "../../packages/help-content/scripts/generate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `pnpm docs:api`(TypeDoc + typedoc-plugin-markdown)が生成する docs/api/ を
 * 読み取ってサイドバー項目を自動生成する。
 *
 * - docs/api/ が存在しない場合(まだ `pnpm docs:api` を実行していない)は
 *   「APIリファレンス」セクション自体を省略し、`vitepress dev` が壊れないようにする
 * - 各パッケージディレクトリ(@kizami/xxx)配下の functions/interfaces/type-aliases/
 *   variables/namespaces を再帰的にたどってサブメニューにする
 */

const apiDir = path.resolve(__dirname, "../api");

interface ApiSidebarItem {
  text: string;
  link?: string;
  collapsed?: boolean;
  items?: ApiSidebarItem[];
}

function toRoute(relPath: string): string {
  // Windows パス区切りを URL 用に正規化
  return `/api/${relPath.split(path.sep).join("/")}`;
}

/** ディレクトリ配下の README.md 以外の .md ファイル・サブディレクトリをサイドバー項目に変換する */
function dirToSidebarItems(absDir: string, relDir: string): ApiSidebarItem[] {
  const entries = readdirSync(absDir).sort((a, b) => a.localeCompare(b));
  const items: ApiSidebarItem[] = [];

  for (const entry of entries) {
    const absEntry = path.join(absDir, entry);
    const relEntry = path.join(relDir, entry);
    const isDir = statSync(absEntry).isDirectory();

    if (isDir) {
      const hasReadme = existsSync(path.join(absEntry, "README.md"));
      const children = dirToSidebarItems(absEntry, relEntry);
      items.push({
        text: entry,
        collapsed: true,
        ...(hasReadme ? { link: `${toRoute(relEntry)}/` } : {}),
        ...(children.length > 0 ? { items: children } : {}),
      });
      continue;
    }

    if (entry === "README.md" || !entry.endsWith(".md")) continue;

    const name = entry.replace(/\.md$/, "");
    items.push({
      text: name,
      link: toRoute(path.join(relDir, name)),
    });
  }

  return items;
}

function buildApiSidebar() {
  if (!existsSync(apiDir)) return [];

  const scopeDir = path.join(apiDir, "@kizami");
  if (!existsSync(scopeDir)) return [];

  const packages = readdirSync(scopeDir)
    .filter((name) => statSync(path.join(scopeDir, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b));

  return [
    {
      text: "APIリファレンス",
      items: [
        { text: "概要", link: "/api/" },
        ...packages.map((pkg) => ({
          text: `@kizami/${pkg}`,
          collapsed: true,
          link: `${toRoute(path.join("@kizami", pkg))}/`,
          items: dirToSidebarItems(path.join(scopeDir, pkg), path.join("@kizami", pkg)),
        })),
      ],
    },
  ];
}

/**
 * packages/help-content/content/*.ja.md を audience で分けたサイドバー項目にする
 * (要件§10・docs/design/ui-direction.md「ガイド・ヘルプの方針」の出し分け: 従業員向け/労務担当者向け)。
 * 同じキーが両方の対象読者を持つ場合は両方の見出しに出てよい(README.mdの方針どおり)。
 *
 * `pnpm docs:guide`(scripts/sync-help-docs.mjs)がまだ実行されておらず docs/guide/ が
 * 存在しない場合は、buildApiSidebar と同じ流儀でこのセクション自体を省略し
 * `vitepress dev` を壊さない。
 */
function buildGuideSidebar() {
  const guideDir = path.resolve(__dirname, "../guide");
  if (!existsSync(guideDir)) return [];

  const entries = collectEntries();
  const firstHeading = (body: string): string => {
    const m = /^#\s+(.+)$/m.exec(body);
    return m ? m[1] : body.slice(0, 20);
  };
  const toItem = (entry: (typeof entries)[number]) => ({
    text: firstHeading(entry.body),
    link: `/guide/${entry.key.split(".").join("-")}`,
  });

  const employeeItems = entries.filter((e) => e.audience.includes("employee")).map(toItem);
  const adminItems = entries.filter((e) => e.audience.includes("admin")).map(toItem);

  return [
    {
      text: "制度ガイド",
      items: [
        { text: "索引", link: "/guide/" },
        { text: "従業員の方へ", collapsed: false, items: employeeItems },
        { text: "労務担当者の方へ", collapsed: false, items: adminItems },
      ],
    },
  ];
}

export default defineConfig({
  title: "KIZAMI",
  description: "日本法準拠のセルフホスト勤怠管理OSS",
  lang: "ja",
  // packages/help-content/content/attendance-flex-frame.ja.md 等、制度ガイド間の相互リンクは
  // 対応するページが用意されているが、今回のスコープ外のキー(例: tenant.special-provision)への
  // リンクも既存文言に含まれているため、ビルドを壊さないよう死リンクチェックは無効化する
  // (§10 該当の4ファイルは文章を書き換えない方針のため、リンク切れの修正はスコープ外)。
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
      ...buildGuideSidebar(),
      ...buildApiSidebar(),
    ],
  },
});
