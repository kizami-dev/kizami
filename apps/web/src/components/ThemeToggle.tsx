"use client";

import { useEffect, useState } from "react";
import { messages } from "../lib/messages";
import { applyTheme, readStoredThemePreference, type ThemePreference } from "../lib/theme";

const OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * ヘッダーのユーザーメニュー内に置くテーマ切り替え(2026-08-22 追加)。
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
    <div className="k-header__theme">
      <span className="k-header__theme-label" id="theme-toggle-label">
        {messages.theme.label}
      </span>
      <div className="k-header__theme-options" role="radiogroup" aria-labelledby="theme-toggle-label">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={pref === option}
            className="k-header__theme-option"
            onClick={() => handleSelect(option)}
          >
            <span className="k-header__theme-option-mark" aria-hidden="true">
              {pref === option ? "●" : "○"}
            </span>
            {messages.theme[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
