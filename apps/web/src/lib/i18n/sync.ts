/**
 * 表示言語とサーバー(users.locale)の同期(2026-10-07、システムメールの多言語化)。
 *
 * サーバーが言語を知っている理由は2つ: (1) 運用者名義のシステムメール(退会の通知など)を本人の言語で
 * 出すため、(2) 端末をまたいで言語の選択を引き継ぐため。ログイン後の初回の GET /me の結果に対して
 * 次の表のとおり決める(`decideLocaleSync`、純粋関数)。
 *
 * | localStorage(明示的な選択) | サーバー | 動作 |
 * | --- | --- | --- |
 * | なし | あり | サーバーの値を採用する(別端末で選んだ言語の引き継ぎ) |
 * | あり(サーバーと違う / サーバーが null) | | 端末の選択をサーバーへ PUT する(1回) |
 * | あり(サーバーと同じ) / なし・サーバーも null | | 何もしない |
 *
 * 判断点: **端末の明示的な選択を優先**する(サーバーの値で上書きしない)。別端末で選んだ言語より、
 * 今この端末で選んでいる言語の方が「いまの本人の意思」に近く、勝手に表示が変わる驚きも無い。
 * 採用は `setLocale` なので localStorage にも保存され、以後は「明示的な選択」として扱われる(同じ値)。
 * ループしない理由: 採用後・PUT 後はどちらも両者が一致するので次回以降は何もしない。さらに
 * `LocaleGate` が言語変更でツリーを再マウントして `useAuthGuard` が再実行されうるため、
 * ページの読み込みごとに1回だけ走らせる(`syncedThisPageLoad`)。PUT の失敗は握る(次の読み込みで
 * 不一致のままなので再試行される)。
 */
import { api } from "../api";
import { isLocale, readStoredLocale, setLocale, type Locale } from "./index";

export interface LocaleSyncDecision {
  /** 画面に採用すべきロケール(サーバーの値)。null = 採用しない */
  adopt: Locale | null;
  /** サーバーへ保存すべきロケール(端末の明示的な選択)。null = 保存しない */
  push: Locale | null;
}

/** `stored` = localStorage の明示的な選択、`server` = GET /me の locale(検証済みの値か null)。 */
export function decideLocaleSync(params: { stored: Locale | null; server: Locale | null }): LocaleSyncDecision {
  const { stored, server } = params;
  if (stored === null) return { adopt: server, push: null };
  if (stored !== server) return { adopt: null, push: stored };
  return { adopt: null, push: null };
}

let syncedThisPageLoad = false;

/** GET /me の `user.locale`(未検証)を受けて、決定どおりに採用・保存する。ページの読み込みごとに1回だけ。 */
export function syncLocaleWithServer(serverLocale: string | null | undefined): void {
  if (syncedThisPageLoad) return;
  syncedThisPageLoad = true;
  const { adopt, push } = decideLocaleSync({ stored: readStoredLocale(), server: isLocale(serverLocale) ? serverLocale : null });
  // 表示が既に同じでも setLocale する(以後「明示的な選択」として localStorage に残す)。
  if (adopt !== null) setLocale(adopt);
  if (push !== null) void api.saveLocale(push).catch(() => {});
}

/** ユーザーが言語を切り替えたとき(設定画面)に呼ぶ。画面は既に切り替わっているので結果は握る。 */
export function saveLocaleToServer(locale: Locale): void {
  void api.saveLocale(locale).catch(() => {});
}
