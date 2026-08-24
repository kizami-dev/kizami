import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "../src/errors.js";
import { migrateDb, type Database } from "./support/db.js";
import { insertAuditLog } from "../src/queries/audit.js";
import {
  createCorrectionRequest,
  getCorrectionRequest,
  listCorrectionRequests,
  updateCorrectionStatus,
} from "../src/queries/corrections.js";
import { getPunchEventById, getValidPunchEvent, insertPunchEvent } from "../src/queries/punches.js";
import { auditLogs, tenants, users } from "../src/schema/index.js";
import { uuidv7 } from "../src/uuid.js";

describe("correction_requests", () => {
  let db: Database;
  const tenantId = uuidv7();
  const userId = uuidv7();
  const otherUserId = uuidv7();

  beforeEach(async () => {
    // @libsql/client のローカル sqlite3 ドライバは `db.transaction()` 実行時にネイティブ接続を
    // トランザクションオブジェクト側へ譲渡し、client 側の接続は commit/rollback 後も戻らない
    // (次回アクセス時に遅延再接続される)。`:memory:` だと再接続 = 新規の空DBになりデータが消えるため、
    // トランザクションを跨いで同一 db を使い続けるこのテストではファイルバックエンドを使う。
    const dbPath = join(tmpdir(), `kizami-test-${randomUUID()}.db`);
    ({ db } = await migrateDb({ url: `file:${dbPath}` }));
    await db.insert(tenants).values({ id: tenantId, name: "Tenant A", createdAt: 0 });
    await db.insert(users).values([
      { id: userId, tenantId, email: "a@example.com", name: "A", createdAt: 0 },
      { id: otherUserId, tenantId, email: "b@example.com", name: "B", createdAt: 0 },
    ]);
  });

  it("createCorrectionRequest defaults status to pending", async () => {
    const req = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      proposedKind: "clock_in",
      proposedOccurredAt: 100,
      reason: "忘れていた",
      createdAt: 0,
    });

    expect(req.status).toBe("pending");
    expect(req.targetEventId).toBeNull();

    const fetched = await getCorrectionRequest(db, req.id);
    expect(fetched?.id).toBe(req.id);
  });

  it("getCorrectionRequest returns null for an unknown id", async () => {
    expect(await getCorrectionRequest(db, uuidv7())).toBeNull();
  });

  it("listCorrectionRequests filters by tenant/user/status and orders newest first", async () => {
    // createdAt をずらして、id(UUIDv7)のミリ秒未満の粒度に依存せず並び順を決定的にする
    const first = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      proposedKind: "clock_in",
      proposedOccurredAt: 100,
      reason: "first",
      createdAt: 0,
    });
    const second = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      proposedKind: "clock_in",
      proposedOccurredAt: 200,
      reason: "second",
      createdAt: 1,
    });
    // 別ユーザーの申請は混ざらないことを確認する
    await createCorrectionRequest(db, {
      tenantId,
      userId: otherUserId,
      requestedBy: otherUserId,
      proposedKind: "clock_in",
      proposedOccurredAt: 300,
      reason: "other user",
      createdAt: 2,
    });

    const all = await listCorrectionRequests(db, { tenantId, userId });
    expect(all.map((r) => r.id)).toEqual([second.id, first.id]);

    await updateCorrectionStatus(db, { id: first.id, tenantId, status: "approved" });
    const pendingOnly = await listCorrectionRequests(db, { tenantId, userId, status: "pending" });
    expect(pendingOnly.map((r) => r.id)).toEqual([second.id]);
  });

  it("updateCorrectionStatus with fromStatus only updates a matching row and returns null otherwise", async () => {
    const req = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      proposedKind: "clock_in",
      proposedOccurredAt: 100,
      reason: "reason",
      createdAt: 0,
    });

    const approved = await updateCorrectionStatus(db, {
      id: req.id,
      tenantId,
      fromStatus: "pending",
      status: "approved",
      decidedBy: userId,
      decidedAt: 10,
      decisionNote: "ok",
    });
    expect(approved?.status).toBe("approved");

    // 既に approved なので pending からの遷移はもう成立しない(0件更新 = null)
    const secondAttempt = await updateCorrectionStatus(db, {
      id: req.id,
      tenantId,
      fromStatus: "pending",
      status: "rejected",
    });
    expect(secondAttempt).toBeNull();

    const stillApproved = await getCorrectionRequest(db, req.id);
    expect(stillApproved?.status).toBe("approved");
  });

  it("insertAuditLog writes action/target/detail into the audit_logs row", async () => {
    const log = await insertAuditLog(db, {
      tenantId,
      actorId: userId,
      action: "correction.approve",
      targetType: "correction_request",
      targetId: "req-1",
      detail: JSON.stringify({ selfApproved: true }),
      occurredAt: 42,
    });

    expect(log.target).toBe("correction_request:req-1");
    expect(log.afterDigest).toBe(JSON.stringify({ selfApproved: true }));

    const rows = await db.select().from(auditLogs);
    expect(rows).toHaveLength(1);
  });

  it("reflects a correction approval atomically inside db.transaction (event insert + status update + audit log)", async () => {
    const target = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_out",
      occurredAt: 500,
      recordedAt: 500,
      source: "web",
      actorId: userId,
    });

    const req = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      targetEventId: target.id,
      proposedKind: "clock_out",
      proposedOccurredAt: 540,
      reason: "退勤時刻の訂正",
      createdAt: 0,
    });

    const result = await db.transaction(async (tx) => {
      const newEvent = await insertPunchEvent(tx, {
        tenantId,
        userId,
        kind: "clock_out",
        occurredAt: 540,
        recordedAt: 1000,
        source: "web",
        actorId: userId,
        supersedesId: target.id,
        correctionRequestId: req.id,
      });
      const updated = await updateCorrectionStatus(tx, {
        id: req.id,
        tenantId,
        fromStatus: "pending",
        status: "approved",
        decidedBy: userId,
        decidedAt: 1000,
      });
      await insertAuditLog(tx, {
        tenantId,
        actorId: userId,
        action: "correction.approve",
        targetType: "correction_request",
        targetId: req.id,
        detail: JSON.stringify({ selfApproved: true }),
        occurredAt: 1000,
      });
      return { newEvent, updated };
    });

    expect(result.updated?.status).toBe("approved");

    // 元イベントは無効化され、新イベントが有効になっている
    expect(await getValidPunchEvent(db, { tenantId, userId, id: target.id })).toBeNull();
    expect((await getValidPunchEvent(db, { tenantId, userId, id: result.newEvent.id }))?.id).toBe(result.newEvent.id);
    expect((await getPunchEventById(db, target.id))?.id).toBe(target.id);

    const logs = await db.select().from(auditLogs);
    expect(logs).toHaveLength(1);
  });

  it("rolls back the whole transaction when the second supersede of the same event violates the UNIQUE index", async () => {
    const target = await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "clock_out",
      occurredAt: 500,
      recordedAt: 500,
      source: "web",
      actorId: userId,
    });

    // 1件目の取消はそのまま成功させておく
    await insertPunchEvent(db, {
      tenantId,
      userId,
      kind: "void",
      occurredAt: 500,
      recordedAt: 600,
      source: "web",
      actorId: userId,
      supersedesId: target.id,
    });

    const raceReq = await createCorrectionRequest(db, {
      tenantId,
      userId,
      requestedBy: userId,
      targetEventId: target.id,
      reason: "重複した取消申請",
      createdAt: 0,
    });

    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await insertPunchEvent(tx, {
          tenantId,
          userId,
          kind: "void",
          occurredAt: 500,
          recordedAt: 700,
          source: "web",
          actorId: userId,
          supersedesId: target.id,
          correctionRequestId: raceReq.id,
        });
        await updateCorrectionStatus(tx, { id: raceReq.id, tenantId, fromStatus: "pending", status: "approved" });
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueConstraintError(caught)).toBe(true);

    // ロールバックされ、申請の status は pending のまま
    const stillPending = await getCorrectionRequest(db, raceReq.id);
    expect(stillPending?.status).toBe("pending");
  });
});
