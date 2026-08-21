/**
 * GET /me
 */

import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";

export function createMeRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const user = c.get("user");
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, tenantId: user.tenantId },
    });
  });

  return app;
}
