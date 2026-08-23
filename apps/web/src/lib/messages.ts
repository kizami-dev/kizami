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

/** apps/api のエラーコード({ error: string })を表示文言へマッピングする(§10 コンテキストヘルプ・messages.ts 集約方針)。 */
export function mapCorrectionErrorMessage(body: unknown): string {
  const errors = messages.corrections.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.corrections.errors.default;
  }
  return messages.corrections.errors.default;
}

/** apps/api の通知設定エラーコード({ error: string })を表示文言へマッピングする(messages.ts 集約方針)。 */
export function mapNotificationSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsNotifications.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsNotifications.errors.default;
  }
  return messages.settingsNotifications.errors.default;
}

/** apps/api の個人通知設定エラーコード({ error: string })を表示文言へマッピングする(messages.ts 集約方針)。 */
export function mapPersonalNotificationSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsPersonalNotifications.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsPersonalNotifications.errors.default;
  }
  return messages.settingsPersonalNotifications.errors.default;
}

/** apps/api の Slack連携設定エラーコード({ error: string })を表示文言へマッピングする(messages.ts 集約方針)。 */
export function mapSlackSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsSlack.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsSlack.errors.default;
  }
  return messages.settingsSlack.errors.default;
}

/** apps/api の Slack連携用トークン確定エラーコード({ error: string })を表示文言へマッピングする(messages.ts 集約方針)。 */
export function mapSlackLinkErrorMessage(body: unknown): string {
  const errors = messages.settingsSlackLink.errors as Record<string, string | undefined>;
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    const code = (body as { error: string }).error;
    return errors[code] ?? messages.settingsSlackLink.errors.default;
  }
  return messages.settingsSlackLink.errors.default;
}

function errorCodeOf(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return null;
}

export function mapDepartmentErrorMessage(body: unknown): string {
  const errors = messages.departments.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.departments.errors.default;
}

/** メンバーの所属変更(PATCH /members/:id)のエラーマッピング。 */
export function mapMemberErrorMessage(body: unknown): string {
  const errors = messages.members.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.members.errors.default;
}

/** 権限プリセット割当(PUT /members/:id/presets)のエラーマッピング。固定原則(自己昇格・自己降格・最後の権限管理保持者)を含む。 */
export function mapAssignmentErrorMessage(body: unknown): string {
  const errors = messages.members.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.members.errors.default;
}

export function mapPresetErrorMessage(body: unknown): string {
  const errors = messages.presets.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.presets.errors.default;
}

/** 月次締め(POST /closings/:period/close・/reopen)のエラーマッピング(v0.3)。 */
export function mapClosingErrorMessage(body: unknown): string {
  const errors = messages.closing.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.closing.errors.default;
}

/** テナントプロファイル(PUT /settings/tenant-profile)のエラーマッピング(v0.3)。 */
export function mapTenantProfileErrorMessage(body: unknown): string {
  const errors = messages.settingsTenantProfile.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsTenantProfile.errors.default;
}

/** 休暇申請(POST /leave/requests・:id/approve・reject・withdraw)のエラーマッピング(v0.3)。 */
export function mapLeaveRequestErrorMessage(body: unknown): string {
  const errors = messages.leave.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.leave.errors.default;
}

/** 有給の制度設定・付与管理(GET/PUT /settings/leave・POST /leave/grants*)のエラーマッピング(v0.3)。 */
export function mapLeaveSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsLeave.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsLeave.errors.default;
}

/** 社内規定(PUT/DELETE /help/overrides/:key・PUT /settings/work-rules-url)のエラーマッピング(2026-08-22)。 */
export function mapHelpSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsHelp.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsHelp.errors.default;
}

/**
 * 勤怠ルールの版管理(POST /settings/attendance・POST /settings/work-policy)のエラーマッピング
 * (2026-08-22 追加)。
 */
export function mapAttendanceSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsAttendance.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsAttendance.errors.default;
}

/** 休憩自動控除の打ち消し申請(POST /auto-break-waivers・:id/approve・reject・withdraw)のエラーマッピング(2026-08-23 追加)。 */
export function mapAutoBreakWaiverErrorMessage(body: unknown): string {
  const errors = messages.autoBreakWaiver.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.autoBreakWaiver.errors.default;
}

/** APIキー発行/失効(POST・DELETE /api-keys)のエラーマッピング(v0.4 追加)。 */
export function mapApiKeysErrorMessage(body: unknown): string {
  const errors = messages.settingsApiKeys.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsApiKeys.errors.default;
}

/**
 * 手当定義の版管理(POST /settings/allowances・POST /settings/allowances/:id/versions)の
 * エラーマッピング(docs/design/allowances.md、2026-08-23 追加)。クライアント側の条件バリデーション
 * (SettingsAllowancesView の buildAllowanceConditionsInput)もサーバーと同じエラーコードを使って
 * この関数へ渡すため、`{ error: "conditions_required" }` のような自前オブジェクトも受け付ける。
 */
export function mapAllowanceSettingsErrorMessage(body: unknown): string {
  const errors = messages.settingsAllowances.errors as Record<string, string | undefined>;
  const code = errorCodeOf(body);
  return (code && errors[code]) ?? messages.settingsAllowances.errors.default;
}
