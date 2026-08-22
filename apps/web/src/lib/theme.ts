/**
 * ダークテーマの永続設定(2026-08-22 追加、v0.1 の宿題 docs/design/ui-direction.md の解消)。
 *
 * 選択肢は3つ: "system"(OS 設定に従う。既定)/ "light" / "dark"。
 * localStorage には常にこの3値のいずれかを保存する。DOM への反映は
 * `document.documentElement` の `data-theme` 属性で行うが、"system" のときは属性を
 * 持たせない(tokens.css の `@media (prefers-color-scheme)` にゆだねる)。
 * 明示選択(light/dark)は OS 設定に優先する(tokens.css の3段構成、`:root[data-theme]`)。
 *
 * FOUC(初期表示のちらつき)防止のため、同じロジックを `_layout.tsx` 内のインライン
 * スクリプト(`THEME_INIT_SCRIPT`、ハイドレーション前に同期実行)でも重複させている。
 * ここを変更する場合は `THEME_INIT_SCRIPT` の生成部分も揃えること(単体の `<script>` として
 * 即時実行する必要があり、モジュールを import できないため文字列化している)。
 */

export const THEME_STORAGE_KEY = "kizami-theme";

export type ThemePreference = "system" | "light" | "dark";

const VALID_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (VALID_PREFERENCES as readonly string[]).includes(value);
}

/** PWA のステータスバー色(theme-color)。--k-paper と一致させる(tokens.css)。 */
const THEME_COLOR: Record<"light" | "dark", string> = {
  light: "#1a1a1a", // 既存の manifest.json / 静的 <meta> と同一値(ライトの見た目は変更しない)。
  dark: "#141618", // tokens.css の --k-paper(ダーク)と一致。
};

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    // プライベートモード等 localStorage が使えない環境では既定(system)にフォールバックする。
    return "system";
  }
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveEffectiveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  return prefersDark() ? "dark" : "light";
}

/**
 * `data-theme` 属性・`theme-color` メタ・localStorage をまとめて更新する。
 * `ThemeToggle` コンポーネントと `_layout.tsx` の初期化スクリプトの双方から使う想定
 * (スクリプト側は import できないため `THEME_INIT_SCRIPT` として同等ロジックを複製する)。
 */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // 保存できなくても表示自体は続行する(このセッション内は動作する)。
  }
  if (pref === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", pref);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", THEME_COLOR[resolveEffectiveTheme(pref)]);
  }
}

/**
 * `_layout.tsx` の `<head>` に埋め込む FOUC 防止用インラインスクリプト(文字列)。
 * ハイドレーション前に同期実行し、`data-theme` 属性と `theme-color` メタを初期値から
 * 動かす。ロジックは `applyTheme`/`readStoredThemePreference` と重複するが、
 * バンドルされた JS の読み込み・ハイドレーションを待たずに実行する必要があるため、
 * 単体の `<script>` として即時実行できる形(文字列)で持つ(意図的な重複、要変更同期)。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var v=localStorage.getItem(k);var pref=(v==="light"||v==="dark")?v:"system";var eff=pref==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):pref;if(pref!=="system"){document.documentElement.setAttribute("data-theme",pref);}var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",eff==="dark"?${JSON.stringify(
  THEME_COLOR.dark,
)}:${JSON.stringify(THEME_COLOR.light)});}}catch(e){}})();`;
