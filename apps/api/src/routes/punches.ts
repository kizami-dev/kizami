/**
 * POST /punches
 */

import { Hono } from "hono";
import { insertPunchEvent, type Database } from "@kizami/db";
import type { PunchKind } from "@kizami/engine";
import type { AppEnv } from "../auth/middleware.js";
import { requireSelf } from "../authz.js";
import { nowMinutes } from "../lib/time.js";

const VALID_KINDS: readonly PunchKind[] = ["clock_in", "clock_out", "break_start", "break_end"];

/** サーバー現在時刻を超えて何分先までを許容するか。 */
const FUTURE_TOLERANCE_MINUTES = 5;

interface PunchBody {
  kind?: unknown;
  occurredAt?: unknown;
}

function isValidKind(value: unknown): value is PunchKind {
  return typeof value === "string" && (VALID_KINDS as readonly string[]).includes(value);
}

export function createPunchesRoutes(db: Database) {
  const app = new Hono<AppEnv>();

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
    const { kind, occurredAt } = body as PunchBody;

    if (!isValidKind(kind)) {
      return c.json({ error: "invalid_kind" }, 400);
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

    const forwardedFor = c.req.header("x-forwarded-for");
    const metaIp = forwardedFor ? (forwardedFor.split(",")[0] as string).trim() : null;
    const metaUa = c.req.header("user-agent") ?? null;

    const event = await insertPunchEvent(db, {
      tenantId: user.tenantId,
      userId: user.id,
      kind,
      occurredAt: occurredAtMinutes,
      recordedAt: now,
      source: "web",
      actorId: user.id,
      metaIp,
      metaUa,
    });

    return c.json({ punch: { id: event.id, kind: event.kind, occurredAt: event.occurredAt } }, 201);
  });

  return app;
}
