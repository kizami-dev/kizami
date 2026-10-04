"use client";

import { useEffect, useState } from "react";
import { messages } from "../lib/messages";
import { applyTheme, readStoredThemePreference, type ThemePreference } from "../lib/theme";

const OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * テーマの選択(2026-08-22 追加。2026-10-05 にヘッダーのユーザーメニューから「言語と表示」設定画面
 * (`DisplaySettingsView`、/settings/display)へ移した)。ログイン前の画面には置かない
 * (そこは保存済みの設定、無ければ OS 設定に従う — `_layout.tsx` の初期化スクリプトが反映する)。
 *
 * `_layout.tsx` のインラインスクリプトが初期表示の `data-theme` を既に反映しているため、
 * ここでの初期状態(サーバー描画時点)は "system" 固定でよい(ハイドレーション後、
 * useEffect で実際の保存値に同期する。見た目に影響するのは打刻画面等の色ではなく
 * この3択の選択状態だけなので、ちらつきは実質発生しない)。
 */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => {
    setPref(readStoredThemePreference());
  }, []);

  function handleSelect(next: ThemePreference) {
    setPref(next);
    applyTheme(next);
  }

  return (
    <div className="display-choice">
      <span className="display-choice__label" id="theme-toggle-label">
        {messages.theme.label}
      </span>
      <div className="display-choice__options" role="radiogroup" aria-labelledby="theme-toggle-label">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={pref === option}
            className="display-choice__option"
            onClick={() => handleSelect(option)}
          >
            <span className="display-choice__mark" aria-hidden="true">
              {pref === option ? "●" : "○"}
            </span>
            {messages.theme[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
