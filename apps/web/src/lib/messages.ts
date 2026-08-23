/**
 * 表示文言のエントリポイント(後方互換レイヤー、2026-08-23 4言語対応で改修)。
 *
 * 実データは apps/web/src/lib/i18n/{ja,en,ko,zh}.ts へ移した(Messages 型は ja から導出、
 * 他ロケールは `satisfies Messages` でキーの過不足をコンパイルエラーにする設計 — 詳細は
 * lib/i18n/index.ts のコメント参照)。この messages.ts は既存の
 * `import { messages } from "../lib/messages"` を書き換えずに済ませるための互換レイヤーで、
 * 「現在ロケールの辞書を常に指す」Proxy として `messages` を再エクスポートする。
 *
 * リアクティブ化の仕組み: `messages` の各プロパティアクセスは、その都度
 * `lib/i18n#getMessages()`(現在ロケールの辞書)を評価して転送する。したがって、
 * 言語切り替え後に呼び出し側コンポーネントが何らかの理由で再レンダリングされれば、
 * 自動的に新しい言語の値を返す。再レンダリングそのものを引き起こすトリガーは
 * `components/LocaleGate.tsx`(_layout.tsx で子ツリー全体をラップし、ロケールが変わると
 * `<Fragment key={locale}>` で丸ごと再マウントする)が担う。これにより、個々のコンポーネントを
 * フック呼び出しへ書き換えることなく、40箇所超ある既存の `messages.xxx` 参照すべてに
 * 新しい言語を反映できる。
 */
import { getMessages, type Messages } from "./i18n";

export const messages: Messages = new Proxy({} as Messages, {
  get(_target, prop, receiver) {
    return Reflect.get(getMessages(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(getMessages(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getMessages());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getMessages(), prop);
  },
}) as Messages;

function errorCodeOf(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

/**
 * apps/api のエラーコード({ error: string })を、指定した messages.xxx.errors セクションの
 * 表示文言へマッピングする関数を作る(2026-08-23 集約: 個別に書かれていた18本の
 * mapXxxErrorMessage 関数を1本のファクトリへ統合。§10 コンテキストヘルプ・messages.ts 集約方針)。
 *
 * `getErrors` を呼び出し時(=描画・イベントハンドラ実行時)まで遅延評価するのは、`messages` が
 * 「現在ロケールを都度読む Proxy」であるため(このファイル冒頭のコメント参照) — ここでモジュール
 * ロード時に一度だけ評価してしまうと、言語切替後も最初に import した言語の文言に凍結される
 * (ApiKeysSettingsView 等で見つかったモジュールレベル凍結バグと同じ性質の問題)。
 */
function makeErrorMapper<E extends Record<string, string> & { default: string }>(getErrors: () => E): (body: unknown) => string {
  return (body: unknown) => {
    const errors = getErrors();
    const code = errorCodeOf(body);
    return (code && errors[code]) ?? errors.default;
  };
}

/** 打刻修正申請(POST /corrections・:id/approve・reject・withdraw)のエラーマッピング。 */
export const mapCorrectionErrorMessage = makeErrorMapper(() => messages.corrections.errors);
/** 通知設定(会社全体、GET/PUT /settings/notifications・POST /settings/notifications/test)のエラーマッピング。 */
export const mapNotificationSettingsErrorMessage = makeErrorMapper(() => messages.settingsNotifications.errors);
/** 個人の通知設定(GET/PUT /settings/notifications/me)のエラーマッピング。 */
export const mapPersonalNotificationSettingsErrorMessage = makeErrorMapper(() => messages.settingsPersonalNotifications.errors);
/** Slack連携設定(GET/PUT /settings/slack)のエラーマッピング。 */
export const mapSlackSettingsErrorMessage = makeErrorMapper(() => messages.settingsSlack.errors);
/** Slack連携用トークン確定(POST /settings/slack-link)のエラーマッピング。 */
export const mapSlackLinkErrorMessage = makeErrorMapper(() => messages.settingsSlackLink.errors);
/** 部署管理(POST/PATCH/DELETE /departments*)のエラーマッピング。 */
export const mapDepartmentErrorMessage = makeErrorMapper(() => messages.departments.errors);
/** メンバーの所属変更(PATCH /members/:id)のエラーマッピング。 */
export const mapMemberErrorMessage = makeErrorMapper(() => messages.members.errors);
/** 権限プリセット割当(PUT /members/:id/presets)のエラーマッピング。固定原則(自己昇格・自己降格・最後の権限管理保持者)を含む。 */
export const mapAssignmentErrorMessage = makeErrorMapper(() => messages.members.errors);
/** 権限プリセット管理(POST/PUT/DELETE /presets*)のエラーマッピング。 */
export const mapPresetErrorMessage = makeErrorMapper(() => messages.presets.errors);
/** 月次締め(POST /closings/:period/close・/reopen)のエラーマッピング(v0.3)。 */
export const mapClosingErrorMessage = makeErrorMapper(() => messages.closing.errors);
/** テナントプロファイル(PUT /settings/tenant-profile)のエラーマッピング(v0.3)。 */
export const mapTenantProfileErrorMessage = makeErrorMapper(() => messages.settingsTenantProfile.errors);
/** 休暇申請(POST /leave/requests・:id/approve・reject・withdraw)のエラーマッピング(v0.3)。 */
export const mapLeaveRequestErrorMessage = makeErrorMapper(() => messages.leave.errors);
/** 有給の制度設定・付与管理(GET/PUT /settings/leave・POST /leave/grants*)のエラーマッピング(v0.3)。 */
export const mapLeaveSettingsErrorMessage = makeErrorMapper(() => messages.settingsLeave.errors);
/** 社内規定(PUT/DELETE /help/overrides/:key・PUT /settings/work-rules-url)のエラーマッピング(2026-08-22)。 */
export const mapHelpSettingsErrorMessage = makeErrorMapper(() => messages.settingsHelp.errors);
/** 勤怠ルールの版管理(POST /settings/attendance・POST /settings/work-policy)のエラーマッピング(2026-08-22 追加)。 */
export const mapAttendanceSettingsErrorMessage = makeErrorMapper(() => messages.settingsAttendance.errors);
/** 休憩自動控除の打ち消し申請(POST /auto-break-waivers・:id/approve・reject・withdraw)のエラーマッピング(2026-08-23 追加)。 */
export const mapAutoBreakWaiverErrorMessage = makeErrorMapper(() => messages.autoBreakWaiver.errors);
/** APIキー発行/失効(POST・DELETE /api-keys)のエラーマッピング(v0.4 追加)。 */
export const mapApiKeysErrorMessage = makeErrorMapper(() => messages.settingsApiKeys.errors);
/**
 * 手当定義の版管理(POST /settings/allowances・POST /settings/allowances/:id/versions)の
 * エラーマッピング(docs/design/allowances.md、2026-08-23 追加)。クライアント側の条件バリデーション
 * (SettingsAllowancesView の buildAllowanceConditionsInput)もサーバーと同じエラーコードを使って
 * この関数へ渡すため、`{ error: "conditions_required" }` のような自前オブジェクトも受け付ける。
 */
export const mapAllowanceSettingsErrorMessage = makeErrorMapper(() => messages.settingsAllowances.errors);
