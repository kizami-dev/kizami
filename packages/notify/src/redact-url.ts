/**
 * エラー文・ログに載せるための URL の伏せ字化。
 *
 * Slack/Discord の Webhook URL や Web Push の endpoint は、パス部分そのものが送信権限を
 * 表す秘密(capability URL)。エラー文に全文を入れると、呼び出し側がそれを監査ログや
 * 応答・ログへ流したとき平文で残る(apps/api の通知テスト送信が監査ログに保存していた)。
 * 原因の切り分けに要るのは宛先のホストまでなので、origin だけを残す。
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return "<invalid url>";
  }
}
