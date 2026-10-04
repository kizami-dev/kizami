"use client";

import { useEffect, useState } from "react";
import { LOCALE_NATIVE_NAMES, LOCALE_ORDER, getLocale, setLocale, type Locale } from "../lib/i18n";
import { messages } from "../lib/messages";

/**
 * ログイン前の画面(ログイン・新規登録・登録確認・招待受諾・パスワード再設定・パスワードを忘れた場合)の
 * 隅に置く、小さな言語切り替え(2026-10-05 追加)。
 *
 * ログイン後の言語切り替えは「言語と表示」設定(`LanguageToggle`)へ移したため、ログイン前に
 * 切り替え手段が無くなると、日本語が読めない人が招待リンクや登録確認リンクを開いたときに
 * 最初の画面で詰まる。そのための控えめなセレクト(ネイティブの <select>)で、`LanguageToggle` と
 * 同じ `setLocale`(localStorage の `kizami-locale` へ保存)を使うので、ここで選んだ言語は
 * ログイン後もそのまま引き継がれる。
 *
 * テーマ切り替えは置かない — ログイン前は保存済みの設定、無ければ OS 設定に従う
 * (`_layout.tsx` の初期化スクリプト)。
 *
 * 選択肢は各言語の自称(LOCALE_NATIVE_NAMES)で固定表記。ラベル(スクリーンリーダー用)は
 * 現在の表示言語の「言語」だが、見た目は地球儀アイコンだけにして場所を取らないようにしている。
 * 初期状態は `LanguageToggle` と同じ理由で "ja" 固定とし、ハイドレーション後に実際の言語へ同期する。
 */
export function PreLoginLanguageSelect() {
  const [locale, setLocaleState] = useState<Locale>("ja");

  useEffect(() => {
    setLocaleState(getLocale());
  }, []);

  function handleChange(next: Locale) {
    setLocaleState(next);
    setLocale(next);
  }

  return (
    <div className="prelogin-language">
      <label className="prelogin-language__label">
        <svg className="prelogin-language__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span className="visually-hidden">{messages.language.label}</span>
        <select
          className="prelogin-language__select"
          value={locale}
          onChange={(e) => handleChange(e.target.value as Locale)}
        >
          {LOCALE_ORDER.map((option) => (
            <option key={option} value={option} lang={option}>
              {LOCALE_NATIVE_NAMES[option]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
