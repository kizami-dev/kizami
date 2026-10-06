/**
 * GET /me, PUT /me/locale, GET /me/effective-permissions
 */

import { Hono } from "hono";
import { getTenantById, getUserById, updateUserLocale, type Database } from "@kizami/db";
import type { AppEnv } from "../auth/middleware.js";
import { parseLocale } from "../lib/locale.js";
import { withdrawalStateOf } from "../lib/tenant-withdrawal.js";

export function createMeRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    // テナント名(社名)を含める(2026-08-23 依頼)。ヘッダー等で「どの会社の勤怠か」を
    // 示すために使う。ログイン画面には出さない — 認証前はテナントが確定せず、将来の
    // マルチテナントで「どの社名を出すか」を決められないため、表示は認証後に限る。
    const tenant = await getTenantById(db, user.tenantId);
    // 退会の状態(2026-10-05、docs/design/tenant-withdrawal.md)。手続き中なら Web が全画面にバナーを出す。
    // 手続き中にここまで来られるのは tenant.withdraw を持つ人だけ(auth/tenant-withdrawal-guard.ts)
    // なので、削除予定の時刻を返してよい。通常の状態では null。
    const withdrawal = withdrawalStateOf(tenant);
    // 表示言語(2026-10-07): 本人が選んだ言語をサーバーにも持つ(システムメールの言語のため。users.locale)。
    // Web は端末をまたいで引き継ぐのにも使う(lib/i18n/sync.ts)。null = 未設定。
    const row = await getUserById(db, { tenantId: user.tenantId, id: user.id });
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, tenantId: user.tenantId, locale: parseLocale(row?.locale) },
      tenant: {
        name: tenant?.name ?? null,
        withdrawal:
          withdrawal.status === "withdrawing"
            ? { requestedAt: withdrawal.requestedAt, scheduledPurgeAt: withdrawal.scheduledPurgeAt }
            : null,
      },
    });
  });

  /**
   * 自分の表示言語を保存する(body `{ locale }`)。**自分の行だけ**を更新する(対象は常にセッションの
   * ユーザーで、userId を受け取らない — 他人の言語は変えられない)。許可リスト外・型違いは 400 `invalid_locale`。
   *
   * 判断点: 権限キーは要らない(セルフサービスの表示設定で、パスワード変更等と同じ「本人なら誰でも」)。
   * 監査ログも残さない(queries/members.ts の updateUserLocale)。退会手続き中も、ログインできる人
   * (`tenant.withdraw` を持つ人)はこの書き込みを通す(auth/tenant-withdrawal-guard.ts の許可リスト。
   * 削除の7日前・完了のメールの言語に効くため)。保存の失敗は画面に見せず、Web 側は結果を無視する(lib/i18n/sync.ts)。
   */
  app.put("/locale", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    const locale = typeof body === "object" && body !== null ? parseLocale((body as Record<string, unknown>).locale) : null;
    if (locale === null) return c.json({ error: "invalid_locale" }, 400);
    const user = c.get("user");
    await updateUserLocale(db, { tenantId: user.tenantId, userId: user.id, locale });
    return c.json({ locale });
  });

  /**
   * 認証済みユーザー自身の実効権限(プリセットの合算・広いスコープ優先・「操作は閲覧を含意」の
   * 展開・セルフサービス権限の常時付与まですべて済んだ最終形)を返す。
   *
   * 判断点(二重実装しない): 権限の解決ロジック自体はここには一切書かない。認証ミドルウェア
   * (apps/api/src/auth/middleware.ts)が各リクエストで既に loadEffectivePermissions を1回
   * 呼び `c.get("permissions")` にキャッシュしており、requirePermission もこのキャッシュ済み
   * 値を読むだけの薄い判定関数になっている(apps/api/src/authz.ts)。このエンドポイントは
   * その既存の解決結果をそのまま JSON へシリアライズするだけの窓口であり、Web 側が
   * 「このユーザーは何ができるか」を UI 表示(メニューの出し分け等)のために問い合わせる
   * 用途を想定する。認可判定そのもの(サーバー側の実施)は既存どおり各エンドポイントの
   * requirePermission が担い続け、このレスポンスはあくまで表示用の参考情報という位置づけ。
   */
  app.get("/effective-permissions", async (c) => {
    const permissions = c.get("permissions");
    return c.json({
      permissions: [...permissions].map(([key, scope]) => ({ key, scope })),
    });
  });

  return app;
}
