/**
 * GET /punches, POST /punches
 */

import { Hono } from "hono";
import { getEffectiveSettingsVersion, insertPunchEvent, listValidPunches, type Database } from "@kizami/db";
import type { PunchKind } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requireSelf } from "../authz.js";
import { periodFromDate, resolveAttendanceDate } from "../lib/attendance-date.js";
import { assertMonthOpen } from "../lib/closing-guard.js";
import { nowMinutes } from "../lib/time.js";

/** 打刻として受け付ける kind。'void'(取消)はシステム内部専用のため申請者は直接指定できない。 */
export const VALID_PUNCH_KINDS: readonly PunchKind[] = ["clock_in", "clock_out", "break_start", "break_end"];

/** サーバー現在時刻を超えて何分先までを許容するか。修正申請の proposedOccurredAt にも流用する。 */
export const FUTURE_TOLERANCE_MINUTES = 5;

interface PunchBody {
  kind?: unknown;
  occurredAt?: unknown;
  /** GPS付き打刻(v0.4、docs/requirements.md §3)。テナントでGPSが有効なときのみ Web 側が送る。 */
  gpsLat?: unknown;
  gpsLng?: unknown;
}

export function isValidPunchKind(value: unknown): value is PunchKind {
  return typeof value === "string" && (VALID_PUNCH_KINDS as readonly string[]).includes(value);
}

function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

/** クエリ文字列を整数(UTC エポック分)としてパースする。不正・非整数は null。 */
function parseRangeParam(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

export function createPunchesRoutes(db: Database) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    const from = parseRangeParam(c.req.query("from"));
    const to = parseRangeParam(c.req.query("to"));
    if (from === null || to === null || from > to) {
      return c.json({ error: "invalid_range" }, 400);
    }

    const punches = await listValidPunches(db, {
      tenantId: user.tenantId,
      userId: user.id,
      fromMinutes: from,
      toMinutes: to,
    });

    return c.json({
      punches: punches.map((p) => ({ id: p.id, kind: p.kind, occurredAt: p.occurredAt })),
    });
  });

  app.post("/", async (c) => {
    const user = c.get("user");
    requireSelf(c, user.id);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { kind, occurredAt, gpsLat, gpsLng } = body as PunchBody;

    if (!isValidPunchKind(kind)) {
      return c.json({ error: "invalid_kind" }, 400);
    }

    // GPS座標(v0.4)。両方省略なら「取得できなかった/対象外」として扱い、打刻自体は止めない
    // (依頼: 許可されなければ位置情報なしで打刻する)。指定された場合のみ形式を検証する。
    let providedGps: { lat: number; lng: number } | null = null;
    if (gpsLat !== undefined || gpsLng !== undefined) {
      if (!isValidLatitude(gpsLat) || !isValidLongitude(gpsLng)) {
        return c.json({ error: "invalid_gps_coordinates" }, 400);
      }
      providedGps = { lat: gpsLat, lng: gpsLng };
    }

    const now = nowMinutes();
    let occurredAtMinutes: number;
    if (occurredAt === undefined) {
      occurredAtMinutes = now;
    } else if (typeof occurredAt === "number" && Number.isInteger(occurredAt)) {
      occurredAtMinutes = occurredAt;
    } else {
      return c.json({ error: "invalid_occurred_at" }, 400);
    }

    if (occurredAtMinutes > now + FUTURE_TOLERANCE_MINUTES) {
      return c.json({ error: "occurred_at_in_future" }, 400);
    }

    // 締め済み月への打刻は全経路で拒否する(docs/requirements.md §6・依頼の禁止事項)。
    const attendanceDate = await resolveAttendanceDate(db, { tenantId: user.tenantId, occurredAt: occurredAtMinutes });
    await assertMonthOpen(db, { tenantId: user.tenantId, period: periodFromDate(attendanceDate) });

    const forwardedFor = c.req.header("x-forwarded-for");
    const metaIp = forwardedFor ? (forwardedFor.split(",")[0] as string).trim() : null;
    const metaUa = c.req.header("user-agent") ?? null;

    // APIキー認証(公開打刻API、v0.4)で通ったリクエストは source="api" にする
    // (c.get("apiKeyScopes") はセッションCookie認証では undefined のまま)。
    const source = c.get("apiKeyScopes") !== undefined ? "api" : "web";

    // テナントでGPSが無効なら、クライアントが座標を送ってきても保存しない(docs/requirements.md §3:
    // 「GPS座標の取得は既定OFF — テナント設定でopt-in」。サーバー側で必ず再確認し、クライアントの
    // 自己申告だけを信用しない)。
    let metaGpsLat: number | null = null;
    let metaGpsLng: number | null = null;
    if (providedGps) {
      const settingsVersion = await getEffectiveSettingsVersion(db, { tenantId: user.tenantId, onDate: attendanceDate });
      if (settingsVersion?.gpsEnabled) {
        metaGpsLat = providedGps.lat;
        metaGpsLng = providedGps.lng;
      }
    }

    const event = await insertPunchEvent(db, {
      tenantId: user.tenantId,
      userId: user.id,
      kind,
      occurredAt: occurredAtMinutes,
      recordedAt: now,
      source,
      actorId: user.id,
      metaIp,
      metaUa,
      metaGpsLat,
      metaGpsLng,
    });

    return c.json({ punch: { id: event.id, kind: event.kind, occurredAt: event.occurredAt } }, 201);
  });

  return app;
}
