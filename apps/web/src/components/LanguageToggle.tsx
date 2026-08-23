"use client";

import { useEffect, useState } from "react";
import { LOCALE_NATIVE_NAMES, LOCALE_ORDER, getLocale, setLocale, type Locale } from "../lib/i18n";
import { messages } from "../lib/messages";

/**
 * ヘッダーのユーザーメニュー内に置く言語切り替え(2026-08-23 追加)。
 *
 * `ThemeToggle`(lib/theme.ts・components/ThemeToggle.tsx)と同じ場所・同じ作法(見た目・
 * radiogroup 構成)で配置する。初期状態は `LocaleGate` と同じ理由でサーバー描画に合わせて
 * "ja" 固定にし、ハイドレーション後の useEffect で実際の選択状態に同期する。
 *
 * 選択肢のラベルは各言語の自称(日本語 / English / 한국어 / 简体中文)で、現在の表示言語に
 * 関わらず常に固定表記にする(要件どおり — messages ではなく lib/i18n の
 * LOCALE_NATIVE_NAMES で持つ)。
 */
export function LanguageToggle() {
  const [locale, setLocaleState] = useState<Locale>("ja");

  useEffect(() => {
    setLocaleState(getLocale());
  }, []);

  function handleSelect(next: Locale) {
    setLocaleState(next);
    setLocale(next);
  }

  return (
    <div className="k-header__language">
      <span className="k-header__language-label" id="language-toggle-label">
        {messages.language.label}
      </span>
      <div className="k-header__language-options" role="radiogroup" aria-labelledby="language-toggle-label">
        {LOCALE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={locale === option}
            className="k-header__language-option"
            onClick={() => handleSelect(option)}
          >
            <span className="k-header__language-option-mark" aria-hidden="true">
              {locale === option ? "●" : "○"}
            </span>
            {LOCALE_NATIVE_NAMES[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
