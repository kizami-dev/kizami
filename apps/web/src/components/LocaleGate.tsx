"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { getLocale, initLocale, subscribeLocale, type Locale } from "../lib/i18n";

/**
 * 言語切り替えの再レンダリング境界(2026-08-23 追加)。`_layout.tsx` で `{children}` を
 * これでラップする。
 *
 * `messages.ts` の `messages` は Proxy で「現在ロケールの辞書」を常に指すが、それだけでは
 * 既に描画済みのコンポーネントの表示は変わらない(React は明示的な再レンダリングなしに
 * JSX の中身を再評価しない)。そこで `<Fragment key={locale}>` を使い、ロケールが変わるたびに
 * `children` 以下のツリーを丸ごとアンマウント→再マウントする。フックを使っていない
 * 既存コンポーネント(`messages.xxx` を直接参照するだけの40箇所超)も、再マウント時に
 * `messages`(Proxy)を新しく読み直すため、これだけで新しい言語が反映される。
 *
 * 初期状態はサーバー描画(静的書き出し)に合わせて "ja" 固定にし、ハイドレーション後の
 * useEffect で実際のロケール(localStorage → navigator.language →既定 "ja")に同期する
 * (`ThemeToggle` が「サーバー描画時点では "system" 固定でよい」としているのと同じ考え方 —
 * lib/theme.ts 冒頭のコメント参照)。これにより初回ハイドレーションのミスマッチを避ける。
 */
export function LocaleGate({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ja");

  useEffect(() => {
    setLocaleState(initLocale());
    return subscribeLocale(() => setLocaleState(getLocale()));
  }, []);

  return <Fragment key={locale}>{children}</Fragment>;
}
