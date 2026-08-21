/**
 * POST /auth/login, POST /auth/logout
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { authCredentials, sessions, users, type Database } from "@kizami/db";
import { verifyPassword } from "../auth/password.js";
import { clearSessionCookie, createSession, getSessionIdFromCookie, setSessionCookie } from "../auth/session.js";
import { nowMinutes } from "../lib/time.js";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export function createAuthRoutes(db: Database) {
  const app = new Hono();

  app.post("/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const { email, password } = body as LoginBody;
    if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") {
      return c.json({ error: "invalid_body" }, 400);
    }

    const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = userRows[0];
    if (!user || !user.isActive) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const credRows = await db.select().from(authCredentials).where(eq(authCredentials.userId, user.id)).limit(1);
    const cred = credRows[0];
    if (!cred) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const ok = await verifyPassword(password, cred.passwordHash);
    if (!ok) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const session = await createSession(db, { tenantId: user.tenantId, userId: user.id, nowMinutes: nowMinutes() });
    setSessionCookie(c, session.id);

    return c.json({ user: { id: user.id, email: user.email, displayName: user.name } }, 200);
  });

  app.post("/logout", async (c) => {
    const sessionId = getSessionIdFromCookie(c);
    if (sessionId) {
      await db.update(sessions).set({ revokedAt: nowMinutes() }).where(eq(sessions.id, sessionId));
    }
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return app;
}
