/**
 * テナントごとの利用上限(2026-10-05、docs/design/tenant-quotas.md、docs/design/saas.md「公開前のギャップ4」)。
 *
 * ## 方針
 *
 * - **配備ごとの環境変数で上限を決める**(全テナント共通の値)。**未設定 = 無制限**で、未設定ならセルフホストの
 *   挙動は一切変わらない。テナントごとの個別の上限は Phase 2(課金)で扱う(ここでは作らない)。
 * - **打刻は止めない**(SaaS の方針)。上限の対象は管理操作(メンバー追加・API キー発行)と外向きの送信だけで、
 *   打刻・修正申請・承認・締めなど勤怠の記録そのものには掛けない。
 * - 値は 0 以上の整数。`0` は「その操作を全部断る」(無制限にしたいときは設定しない)。形式が不正なら起動時に落とす
 *   (設定したつもりで無制限、を避けるため)。
 *
 * | 環境変数 | 上限 | 超えたとき |
 * |---|---|---|
 * | `QUOTA_MAX_MEMBERS` | 在籍メンバー数(**招待中を含む**) | 招待・再有効化が 409 `member_limit_reached` |
 * | `QUOTA_MAX_API_KEYS` | 有効な API キー数 | 発行が 409 `api_key_limit_reached` |
 * | `QUOTA_OUTBOUND_NOTIFICATIONS_PER_DAY` | 外向きの通知(Webhook・メール)の1日の送信数 | 送信をやめ、管理者にアプリ内通知(1日1回) |
 * | `QUOTA_INVITE_RESET_MAILS_PER_DAY` | **管理者が行う**招待・パスワード再設定リンクの1日の発行数 | 発行が 409 `invite_reset_limit_reached` |
 *
 * 1日は日本時間の 0 時区切り。ブラウザプッシュとアプリ内通知は「外向きの通知」に数えない
 * (プッシュは本人のブラウザ宛、アプリ内は外部へ出ないため)。メンバー数に招待中を含めるのは、招待した時点で
 * users 行ができて席を占めるため(受諾を待って数えると、招待だけ大量に出して上限を回避できる)。
 *
 * ## 枠を消費できる操作(原則: 守りたい側の操作だけ)

枠を消費できるのは、その枠で守りたい側(管理者・システム)の操作だけ。未認証の操作や一般メンバーの操作が、
テナント全体の枠を使い切って管理者・業務を止められてはならない(上限そのものを妨害に使わせない)。

| 操作 | 数える先 |
| --- | --- |
| システムが送る業務通知(打刻忘れ・36協定・有給・シフトのスキャン、承認・却下の結果と2段目の承認依頼の Webhook/メール) | テナントの外向きの通知の枠 |
| 管理者の通知設定のテスト送信(`POST /settings/notifications/test`) | テナントの外向きの通知の枠(通知設定の管理権限が要る) |
| 一般メンバーの個人 Webhook のテスト送信(`POST /settings/notifications/me/test`) | **本人ごとの1日 5 回**(テナントの枠は使わない) |
| 一般メンバーの申請(修正・休暇・自動休憩の打ち消し)が起こす承認依頼の Webhook/メール | **本人ごとの1日 100 件**を先に数え、通ったものだけテナントの外向きの通知の枠 |
| 管理者の招待・招待の再発行・パスワード再設定リンクの発行 | テナントの招待・再設定の枠 |
| 未認証の本人用「パスワードを忘れた」 | **テナントの枠は使わない**(IP ごとのレート制限 + メールごとの 5 分スロットルで守る) |
| メンバー数・API キー数 | 管理者の発行・招待だけが増やす(現在の数で判定。一般メンバーは増やせない) |

一般メンバーの申請が起こす承認依頼の通知は二段で数える: まず申請者本人ごとの1日 100 件(`MEMBER_TRIGGERED_SENDS_PER_DAY`)、
通ったものだけテナントの枠。本人の枠が尽きたら送らず(アプリ内通知は通常どおり作る)、管理者への通知も出さない
(管理者への通知はテナントの枠の話で、1人の連打を知らせるものではない)。これで悪意のあるメンバー1人が申請を連打しても
テナントの枠を 100 件までしか使えない。残る注意: メンバーが多数いて全員が連打すれば(人数 × 100 件)テナントの枠を使い切れる。
本人の枠を通ったあとテナントの枠で断られた場合、本人の枠は戻さない(単純さを取った)。

## 判定の精度
 *
 * 日次の送信数は 1 文の UPSERT で原子的に数える(上限を超えて通らない)。メンバー数・API キー数は「数えてから作る」
 * ので、同時リクエストで上限を数件超えうる(管理操作で頻度が低く、厳密さより単純さを取った)。
 *
 * 上限に達して断るたびに `tenant_usage_counters` の `hit:<上限名>` を +1 し、`/metrics` が
 * `kizami_quota_limit_hits_total{limit}`(テナントを区別しない全体の累計)として出す。
 */

import { countActiveApiKeys, countActiveMembers, consumeTenantDailyCounter, createNotificationIfAbsent, incrementTenantCounter, QUOTA_HIT_PREFIX, usageDayFromMinutes, type Database } from "@kizami/db";
import { resolveTenantScopeApprovers } from "./approvers.js";
import { nowMinutes as realNowMinutes } from "./time.js";

export interface TenantQuotaLimits {
  /** 在籍メンバー数(招待中を含む)。undefined = 無制限 */
  members?: number;
  /** 有効な API キー数 */
  apiKeys?: number;
  /** 外向きの通知(Webhook・メール)の1日の送信数 */
  outboundNotificationsPerDay?: number;
  /** 招待・パスワード再設定のメールの1日の送信数 */
  inviteResetMailsPerDay?: number;
}

export const QUOTA_ENV = {
  members: "QUOTA_MAX_MEMBERS",
  apiKeys: "QUOTA_MAX_API_KEYS",
  outboundNotificationsPerDay: "QUOTA_OUTBOUND_NOTIFICATIONS_PER_DAY",
  inviteResetMailsPerDay: "QUOTA_INVITE_RESET_MAILS_PER_DAY",
} as const satisfies Record<keyof TenantQuotaLimits, string>;

export interface QuotaEnvResult {
  limits: TenantQuotaLimits;
  errors: string[];
}

/** 環境変数から上限を読む(env を引数に取る純関数)。空・未設定は無制限、0 以上の整数だけを受け付ける。 */
export function parseQuotaEnv(env: Record<string, string | undefined>): QuotaEnvResult {
  const limits: TenantQuotaLimits = {};
  const errors: string[] = [];
  for (const [field, name] of Object.entries(QUOTA_ENV) as Array<[keyof TenantQuotaLimits, string]>) {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") continue;
    if (!/^\d{1,9}$/.test(raw)) {
      errors.push(`${name} must be a non-negative integer (leave it unset for unlimited), got: ${raw}`);
      continue;
    }
    limits[field] = Number(raw);
  }
  return { limits, errors };
}

/** 外向きの通知の1日の上限に達したときに、チャネルの send が投げる。メッセージは画面側が固定文字列で判定する。 */
export class NotificationQuotaExceededError extends Error {
  constructor() {
    super("notification_limit_reached");
    this.name = "NotificationQuotaExceededError";
  }
}

export type CapacityVerdict = { ok: true } | { ok: false; limit: number };

export interface TenantQuotas {
  readonly limits: TenantQuotaLimits;
  /** メンバーを1人増やせるか(招待・再有効化の前)。断ったら hit を記録する */
  checkMemberCapacity(db: Database, tenantId: string): Promise<CapacityVerdict>;
  /** API キーを1本増やせるか */
  checkApiKeyCapacity(db: Database, tenantId: string): Promise<CapacityVerdict>;
  /** 外向きの通知を1件送ってよいか(送るなら +1 する)。断ったら hit を記録し、その日の初回は管理者にアプリ内で知らせる */
  consumeOutboundNotification(db: Database, tenantId: string): Promise<boolean>;
  /**
   * 本人が起こす送信(個人 Webhook のテスト送信)をしてよいか。**本人ごとの1日の小さな上限**
   * (`PERSONAL_TEST_SENDS_PER_DAY`)で、テナントの枠は使わない。外向きの通知の上限が設定されている配備だけで働く。
   */
  consumePersonalTestSend(db: Database, tenantId: string, userId: string): Promise<boolean>;
  /**
   * 一般メンバーの申請が起こす承認依頼の送信(Webhook・メール)をしてよいか。**二段**: ①申請者本人ごとの1日の上限
   * (`MEMBER_TRIGGERED_SENDS_PER_DAY`)を先に数え、②通ったら `consumeOutboundNotification` と同じくテナントの枠を数える。
   * ①で断るときはテナントの枠に触れず、管理者へも知らせない。外向きの通知の上限が未設定なら素通し(何も数えない)。
   */
  consumeMemberTriggeredOutbound(db: Database, tenantId: string, userId: string): Promise<boolean>;
  /** 管理者が行う招待・再設定リンクの発行をしてよいか(発行するなら +1 する)。断ったら hit を記録する */
  consumeInviteResetMail(db: Database, tenantId: string): Promise<boolean>;
}

/** 一般メンバーの個人 Webhook のテスト送信の、本人ごとの1日の上限。 */
export const PERSONAL_TEST_SENDS_PER_DAY = 5;

/**
 * 一般メンバーの申請(修正・休暇・自動休憩の打ち消し)が起こす承認依頼の送信の、申請者本人ごとの1日の上限。
 * 申請1件で承認者の人数 + テナント共有の数件が出るため、通常の業務より十分大きく、連打には小さい値にしている。
 */
export const MEMBER_TRIGGERED_SENDS_PER_DAY = 100;

const NOTIFICATION_SETTINGS_PERMISSION = "notification.settings.manage";
const QUOTA_NOTICE_TYPE = "quota_notification_limit";

/** 日本時間の日付 "YYYY-MM-DD"(通知の重複防止キー) */
function jstDateString(epochMinutes: number): string {
  return new Date((epochMinutes + 9 * 60) * 60_000).toISOString().slice(0, 10);
}

export function createTenantQuotas(limits: TenantQuotaLimits, options: {
    nowMinutes?: () => number;
    /** 本人ごとの上限の差し替え(テスト用)。省略時は MEMBER_TRIGGERED_SENDS_PER_DAY */
    memberTriggeredSendsPerDay?: number;
  } = {}): TenantQuotas {
  const nowMinutes = options.nowMinutes ?? realNowMinutes;
  const memberTriggeredSendsPerDay = options.memberTriggeredSendsPerDay ?? MEMBER_TRIGGERED_SENDS_PER_DAY;

  async function recordHit(db: Database, tenantId: string, limitName: string): Promise<void> {
    try {
      await incrementTenantCounter(db, { tenantId, counterKey: `${QUOTA_HIT_PREFIX}${limitName}`, day: usageDayFromMinutes(nowMinutes()) });
    } catch (err) {
      // 記録の失敗で本来の判定(断る)を変えない
      console.error("[tenant-quotas] failed to record a limit hit:", err);
    }
  }

  /** 管理者(通知設定の管理権限を tenant スコープで持つ人)へのアプリ内通知。同じ日に重複して作られない(UNIQUE)。 */
  async function notifyAdminsOutboundLimit(db: Database, tenantId: string): Promise<void> {
    try {
      const now = nowMinutes();
      const admins = await resolveTenantScopeApprovers(db, { tenantId, permission: NOTIFICATION_SETTINGS_PERMISSION });
      for (const userId of admins) {
        await createNotificationIfAbsent(db, {
          tenantId,
          userId,
          type: QUOTA_NOTICE_TYPE,
          subjectDate: jstDateString(now),
          title: "外向きの通知の1日の送信上限に達しました",
          body: `本日(日本時間)の外向きの通知(Webhook・メール)の送信数が上限(${limits.outboundNotificationsPerDay}件)に達したため、これ以降の外向きの通知は送信されません。アプリ内の通知と打刻は通常どおり使えます。日本時間の 0 時に再び送信されます。`,
          createdAt: now,
        });
      }
    } catch (err) {
      console.error("[tenant-quotas] failed to notify admins about the outbound notification limit:", err);
    }
  }

  async function consumeDaily(db: Database, tenantId: string, counterKey: string, limit: number | undefined): Promise<boolean> {
    if (limit === undefined) return true;
    const result = await consumeTenantDailyCounter(db, { tenantId, counterKey, day: usageDayFromMinutes(nowMinutes()), limit });
    if (!result.allowed) await recordHit(db, tenantId, counterKey);
    return result.allowed;
  }

  /** テナントの外向きの通知の枠を1件使う。断ったら管理者へ1日1回知らせる(consumeMemberTriggeredOutbound の②からも使う)。 */
  async function consumeTenantOutbound(db: Database, tenantId: string): Promise<boolean> {
    const allowed = await consumeDaily(db, tenantId, "outbound_notifications", limits.outboundNotificationsPerDay);
    if (!allowed) await notifyAdminsOutboundLimit(db, tenantId);
    return allowed;
  }

  return {
    limits,
    async checkMemberCapacity(db, tenantId) {
      if (limits.members === undefined) return { ok: true };
      if ((await countActiveMembers(db, tenantId)) < limits.members) return { ok: true };
      await recordHit(db, tenantId, "members");
      return { ok: false, limit: limits.members };
    },
    async checkApiKeyCapacity(db, tenantId) {
      if (limits.apiKeys === undefined) return { ok: true };
      if ((await countActiveApiKeys(db, { tenantId, nowMinutes: nowMinutes() })) < limits.apiKeys) return { ok: true };
      await recordHit(db, tenantId, "api_keys");
      return { ok: false, limit: limits.apiKeys };
    },
    consumeOutboundNotification: consumeTenantOutbound,
    async consumePersonalTestSend(db, tenantId, userId) {
      if (limits.outboundNotificationsPerDay === undefined) return true;
      return (
        await consumeTenantDailyCounter(db, {
          tenantId,
          counterKey: `personal_test_send:${userId}`,
          day: usageDayFromMinutes(nowMinutes()),
          limit: PERSONAL_TEST_SENDS_PER_DAY,
        })
      ).allowed;
    },
    async consumeMemberTriggeredOutbound(db, tenantId, userId) {
      // 判断点: テナントの上限が未設定なら無制限(consumePersonalTestSend と同じ。セルフホストの挙動を変えない)。
      if (limits.outboundNotificationsPerDay === undefined) return true;
      // 判断点: ①本人ごとの枠を先に数える。本人の枠で断るときは hit を既存の `outbound_notifications` に記録する
      // (メトリクスのラベル集合を増やさない)が、管理者へは知らせない(管理者への通知はテナントの枠の話)。
      // 本人の枠を通ってテナントの枠で断られた場合、本人の枠は戻さない(許容: 戻すと原子性の扱いが増えるため)。
      const own = await consumeTenantDailyCounter(db, {
        tenantId,
        counterKey: `member_triggered:${userId}`,
        day: usageDayFromMinutes(nowMinutes()),
        limit: memberTriggeredSendsPerDay,
      });
      if (!own.allowed) {
        await recordHit(db, tenantId, "outbound_notifications");
        return false;
      }
      // ②テナントの枠(従来どおり。断ったら管理者へ1日1回知らせる)
      return consumeTenantOutbound(db, tenantId);
    },
    consumeInviteResetMail(db, tenantId) {
      return consumeDaily(db, tenantId, "invite_reset_mails", limits.inviteResetMailsPerDay);
    },
  };
}
