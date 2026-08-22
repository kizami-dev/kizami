/**
 * POST /slack/commands — Slackスラッシュコマンド(`/punch in|out|break|back|status|link`)からの打刻。
 *
 * docs/external-api/slack.md が仕様の正。要点:
 * - **認証ミドルウェアの外側**に置く(app.ts で `authed` サブルータではなく `app` に直接マウントする)。
 *   Slack はセッションCookieを持たない。署名検証(`X-Slack-Signature` / `X-Slack-Request-Timestamp`、
 *   lib/slack-signature.ts)が認証の代わりになる
 * - Content-Type は `application/x-www-form-urlencoded`(JSONではない)。署名は生のリクエストボディに
 *   対して計算されるため、`c.req.text()` で生文字列を取得してから `URLSearchParams` でパースする
 *   (Hono の `c.req.parseBody()` は既にデコード済みの値を返すため、生ボディの再構築が必要になり
 *   URLエンコードの正規化差異で署名が合わなくなるリスクがある。生文字列をそのまま署名検証に使う)
 * - テナントの特定は `team_id`(Slack ワークスペースID)から `tenant_slack_settings` を逆引きする
 *   唯一の経路(「1テナント=1ワークスペース」前提。依頼どおり複数テナント共有は想定しない)
 * - 打刻の実装は routes/punches.ts の POST ハンドラを**HTTPで叩き直さず**、同じ下位関数
 *   (resolveAttendanceDate・assertMonthOpen・insertPunchEvent)を直接呼ぶ
 * - 応答は必ず `response_type: "ephemeral"`。打刻の事実が他のメンバーに流れないようにするため
 * - 打刻の `source` は `"slack"` として記録する
 * - 無効な遷移(勤務外の退勤等)は実行前に理由を添えて断る(GET /attendance/status と同じ
 *   `deriveStatus` ロジックを apps/api/src/routes/attendance.ts から再利用して「今の状態」を判定する)
 * - 3秒以内に応答する制約(Slack仕様): このエンドポイントが行う処理はDB読み書き数件のみで
 *   重い処理が無いため、`response_url` への遅延応答は使わず同期的に応答する(依頼の「判断して
 *   実装すること」への回答。理由は完了報告に明記)
 *
 * ユーザーの紐付け(依頼の判断点、完了報告に明記):
 * メールアドレスでの自動照合(Slack `users.info` API、Bot Token必須)は実装しない。
 * Bot Tokenを要求すると導入の手間が増えるため、まず`/punch link`(ワンタイムトークンによる
 * 明示連携)のみを確実に動かす段階的な設計を採用した。将来、Bot Tokenをテナント設定に
 * 追加できるようになった時点で自動照合をオプション機能として追加できる(tenant_slack_settings
 * に bot_token 列を足すだけで拡張できる形にしてある)。
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  getSlackUserLinkBySlackUserId,
  getTenantSlackSettingsByTeamId,
  getUserById,
  insertPunchEvent,
  insertSlackLinkToken,
  listValidPunches,
  type Database,
} from "@kizami/db";
import type { PunchKind } from "@kizami/engine";
import { sha256Hex } from "../auth/api-key.js";
import { MonthClosedError, assertMonthOpen } from "../lib/closing-guard.js";
import { decryptSecret, type Encryptor } from "../lib/encryption.js";
import { periodFromDate, resolveAttendanceDate } from "../lib/attendance-date.js";
import { TZ_OFFSET_MINUTES_JST } from "../lib/settings.js";
import { verifySlackSignature } from "../lib/slack-signature.js";
import { nowMinutes } from "../lib/time.js";
import { deriveStatus, resolveTodayWindow, type AttendanceState } from "./attendance.js";

/** `/punch link` が発行するワンタイムトークンの有効期限(依頼: 短命・15分)。 */
export const SLACK_LINK_TOKEN_TTL_MINUTES = 15;

const KIND_LABELS: Record<PunchKind, string> = {
  clock_in: "出勤",
  clock_out: "退勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
};

/** サブコマンド("in"等) → 打刻kind。 */
const SUBCOMMAND_TO_KIND: Record<string, PunchKind> = {
  in: "clock_in",
  out: "clock_out",
  break: "break_start",
  back: "break_end",
};

const USAGE_TEXT = [
  "*KIZAMI 打刻コマンド*",
  "`/punch in` — 出勤",
  "`/punch out` — 退勤",
  "`/punch break` — 休憩に入る",
  "`/punch back` — 休憩から戻る",
  "`/punch status` — 現在の状態と今日の打刻を確認",
  "`/punch link` — KIZAMIアカウントとの連携用トークンを発行",
].join("\n");

const NOT_LINKED_TEXT =
  "このSlackアカウントはまだKIZAMIアカウントと連携されていません。`/punch link` を実行し、" +
  "発行されたトークンをKIZAMIの「設定 > Slack連携」画面(15分以内)で入力してください。";

function ephemeral(text: string) {
  return { response_type: "ephemeral" as const, text };
}

/** UTCエポック分を JST の "HH:mm" に整形する(ephemeral応答の表示用)。 */
function formatJstTime(utcMinutes: number): string {
  const localMinutes = (((utcMinutes + TZ_OFFSET_MINUTES_JST) % 1440) + 1440) % 1440;
  const hh = Math.floor(localMinutes / 60);
  const mm = localMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** state に対する日本語ラベル(`/punch status` 表示用)。 */
function stateLabel(state: AttendanceState): string {
  if (state === "working") return "勤務中";
  if (state === "onBreak") return "休憩中";
  return "勤務外";
}

/**
 * 打刻kindが今の状態(state)から実行可能かを判定する。
 * apps/api/src/routes/attendance.ts の deriveStatus と同じ遷移規則(不正打刻列の解釈ルール)に
 * 従う: out→clock_in、working→clock_out/break_start、onBreak→break_end/clock_out。
 */
function validateTransition(kind: PunchKind, state: AttendanceState): { ok: true } | { ok: false; reason: string } {
  switch (kind) {
    case "clock_in":
      if (state !== "out") {
        return { ok: false, reason: state === "onBreak" ? "既に休憩中です。先に `/punch back` で復帰してください。" : "既に出勤中です。" };
      }
      return { ok: true };
    case "clock_out":
      if (state === "out") {
        return { ok: false, reason: "まだ出勤していないため退勤できません。先に `/punch in` してください。" };
      }
      return { ok: true };
    case "break_start":
      if (state !== "working") {
        return { ok: false, reason: state === "onBreak" ? "既に休憩中です。" : "出勤していないため休憩に入れません。先に `/punch in` してください。" };
      }
      return { ok: true };
    case "break_end":
      if (state !== "onBreak") {
        return { ok: false, reason: "休憩中ではないため休憩から戻れません。" };
      }
      return { ok: true };
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** `/punch link` 用のワンタイムトークンを生成する(api-key.ts の generateApiKey と同じ乱数方式、専用プレフィクス)。 */
function generateLinkToken(): string {
  const raw = new Uint8Array(24);
  crypto.getRandomValues(raw);
  return `kzsl_${base64url(raw)}`;
}

export interface SlackRoutesDeps {
  /** Signing Secret の復号に使う。null/未設定なら全リクエストが署名検証で拒否される(平文フォールバックはしない)。 */
  encryptor?: Encryptor | null;
}

export function createSlackRoutes(db: Database, deps: SlackRoutesDeps = {}) {
  const app = new Hono();

  app.post("/commands", async (c) => {
    // 署名はこの生ボディ文字列に対して計算されている。パース前の値をそのまま検証に使う。
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    const teamId = params.get("team_id");
    const slackUserId = params.get("user_id");
    const text = (params.get("text") ?? "").trim();

    if (!teamId || !slackUserId) {
      return c.json(ephemeral("リクエストの形式が不正です。"), 400);
    }

    const settings = await getTenantSlackSettingsByTeamId(db, teamId);
    if (!settings || !settings.enabled) {
      // 未設定/無効化されたテナントの区別はしない(存在有無を漏らさないため同一メッセージ)。
      return c.json(ephemeral("このワークスペースではSlack打刻が設定されていません。管理者に設定を依頼してください。"));
    }

    const signingSecretPlain = settings.signingSecret ? await decryptSecret(deps.encryptor, settings.signingSecret) : null;
    const verified = await verifySlackSignature({
      signingSecret: signingSecretPlain,
      signatureHeader: c.req.header("x-slack-signature") ?? null,
      timestampHeader: c.req.header("x-slack-request-timestamp") ?? null,
      rawBody,
    });
    if (!verified) {
      return c.json({ error: "invalid_signature" }, 401);
    }

    const tenantId = settings.tenantId;
    const [sub] = text.split(/\s+/).filter(Boolean);

    if (!sub) {
      return c.json(ephemeral(USAGE_TEXT));
    }

    if (sub === "link") {
      const token = generateLinkToken();
      const now = nowMinutes();
      await insertSlackLinkToken(db, {
        id: randomUUID(),
        tenantId,
        slackUserId,
        tokenHash: await sha256Hex(token),
        expiresAt: now + SLACK_LINK_TOKEN_TTL_MINUTES,
        createdAt: now,
      });
      return c.json(
        ephemeral(
          `KIZAMIとの連携用トークンを発行しました(${SLACK_LINK_TOKEN_TTL_MINUTES}分間有効)。\n` +
            `KIZAMIの「設定 > Slack連携」画面でこのトークンを入力してください。\n\`${token}\``,
        ),
      );
    }

    if (sub !== "status" && !(sub in SUBCOMMAND_TO_KIND)) {
      return c.json(ephemeral(`不明なコマンドです。\n\n${USAGE_TEXT}`));
    }

    // in/out/break/back/status はいずれも連携済みのkizamiユーザーが必要。
    const link = await getSlackUserLinkBySlackUserId(db, { tenantId, slackUserId });
    if (!link) {
      return c.json(ephemeral(NOT_LINKED_TEXT));
    }
    const userRow = await getUserById(db, { tenantId, id: link.userId });
    if (!userRow || !userRow.isActive) {
      return c.json(ephemeral("連携されているKIZAMIアカウントが無効になっています。管理者に確認してください。"));
    }

    const now = nowMinutes();
    let window: { dayStart: number; dayEnd: number };
    try {
      window = await resolveTodayWindow(db, tenantId, now);
    } catch {
      return c.json(ephemeral("テナント設定を解決できませんでした。管理者に確認してください。"));
    }
    const todaysPunches = await listValidPunches(db, {
      tenantId,
      userId: link.userId,
      fromMinutes: window.dayStart,
      toMinutes: window.dayEnd - 1,
    });
    const status = deriveStatus(todaysPunches);

    if (sub === "status") {
      const lines = [`現在の状態: *${stateLabel(status.state)}*`];
      if (todaysPunches.length > 0) {
        lines.push("");
        lines.push("今日の打刻:");
        for (const p of todaysPunches) {
          lines.push(`- ${KIND_LABELS[p.kind as PunchKind] ?? p.kind} ${formatJstTime(p.occurredAt)}`);
        }
      } else {
        lines.push("今日はまだ打刻がありません。");
      }
      return c.json(ephemeral(lines.join("\n")));
    }

    const kind = SUBCOMMAND_TO_KIND[sub] as PunchKind;
    const transition = validateTransition(kind, status.state);
    if (!transition.ok) {
      return c.json(ephemeral(transition.reason));
    }

    let attendanceDate: string;
    try {
      attendanceDate = await resolveAttendanceDate(db, { tenantId, occurredAt: now });
      await assertMonthOpen(db, { tenantId, period: periodFromDate(attendanceDate) });
    } catch (err) {
      if (err instanceof MonthClosedError) {
        return c.json(ephemeral("この月は締め済みのため打刻できません。管理者に修正申請の要否を確認してください。"));
      }
      throw err;
    }

    // Slack経由の打刻はIP/UAもSlackサーバーのものになる(docs/external-api/slack.md「打刻の証跡」)。
    // 「誰が」の裏付けは署名検証とアカウント紐付けに依存するため、位置情報は付与しない。
    const event = await insertPunchEvent(db, {
      tenantId,
      userId: link.userId,
      kind,
      occurredAt: now,
      recordedAt: now,
      source: "slack",
      actorId: link.userId,
      metaIp: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      metaUa: c.req.header("user-agent") ?? null,
      metaGpsLat: null,
      metaGpsLng: null,
    });

    return c.json(ephemeral(`${KIND_LABELS[event.kind as PunchKind]}を記録しました(${formatJstTime(event.occurredAt)})。`));
  });

  return app;
}
