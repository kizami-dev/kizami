"use client";

import { useEffect, useState } from "react";
import { LOCALE_NATIVE_NAMES, LOCALE_ORDER, getLocale, setLocale, type Locale } from "../lib/i18n";
import { messages } from "../lib/messages";

/**
 * 言語の選択(2026-08-23 追加。2026-10-05 にヘッダーのユーザーメニューから「言語と表示」設定画面
 * (`DisplaySettingsView`、/settings/display)へ移した)。
 *
 * `ThemeToggle`(lib/theme.ts・components/ThemeToggle.tsx)と同じ作法(見た目・radiogroup 構成)。
 * 初期状態は `LocaleGate` と同じ理由でサーバー描画に合わせて "ja" 固定にし、ハイドレーション後の
 * useEffect で実際の選択状態に同期する。
 *
 * 選択肢のラベルは各言語の自称(日本語 / English / 한국어 / 简体中文 / 繁體中文)で、現在の表示言語に
 * 関わらず常に固定表記にする(要件どおり — messages ではなく lib/i18n の
 * LOCALE_NATIVE_NAMES で持つ)。ログイン前の画面には、このラジオ群ではなく控えめな
 * `PreLoginLanguageSelect` を置く(同じ `setLocale` を使うため保存先・挙動は同一)。
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
    <div className="display-choice">
      <span className="display-choice__label" id="language-toggle-label">
        {messages.language.label}
      </span>
      <div className="display-choice__options" role="radiogroup" aria-labelledby="language-toggle-label">
        {LOCALE_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={locale === option}
            className="display-choice__option"
            onClick={() => handleSelect(option)}
          >
            <span className="display-choice__mark" aria-hidden="true">
              {locale === option ? "●" : "○"}
            </span>
            {LOCALE_NATIVE_NAMES[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
