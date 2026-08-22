import { describe, expect, it, vi } from "vitest";
import type { KizamiApiClient } from "../src/client.js";
import { KizamiApiError } from "../src/client.js";
import {
  handleGetLeaveBalance,
  handleGetMonthlySummary,
  handleGetStatus,
  handleListCorrections,
  handlePunch,
} from "../src/tools.js";

/** テスト用の最小フェイククライアント。使うメソッドだけ vi.fn() で差し替える。 */
function fakeClient(overrides: Partial<Record<keyof KizamiApiClient, ReturnType<typeof vi.fn>>>): KizamiApiClient {
  return overrides as unknown as KizamiApiClient;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first && first.type === "text" ? (first.text ?? "") : "";
}

describe("handlePunch — invalid transitions are stopped before calling the API", () => {
  it("refuses clock_out while state is 'out' and never calls client.punch()", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "out", lastPunch: null });
    const punch = vi.fn();
    const client = fakeClient({ getStatus, punch });

    const result = await handlePunch(client, { kind: "clock_out" });

    expect(punch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/勤務外/);
    expect(textOf(result)).toMatch(/退勤/);
  });

  it("refuses a duplicate clock_in while state is 'working'", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "working", lastPunch: { kind: "clock_in", occurredAt: 0 } });
    const punch = vi.fn();
    const client = fakeClient({ getStatus, punch });

    const result = await handlePunch(client, { kind: "clock_in" });

    expect(punch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/勤務中/);
  });

  it("refuses break_start while state is 'onBreak' (already on break)", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "onBreak", lastPunch: { kind: "break_start", occurredAt: 0 } });
    const punch = vi.fn();
    const client = fakeClient({ getStatus, punch });

    const result = await handlePunch(client, { kind: "break_start" });

    expect(punch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("allows clock_out during a break (valid per KIZAMI's own transition rules)", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "onBreak", lastPunch: { kind: "break_start", occurredAt: 0 } });
    const punch = vi.fn().mockResolvedValue({ id: "p1", kind: "clock_out", occurredAt: 120 });
    const client = fakeClient({ getStatus, punch });

    const result = await handlePunch(client, { kind: "clock_out" });

    expect(punch).toHaveBeenCalledWith({ kind: "clock_out" });
    expect(result.isError).toBeFalsy();
  });
});

describe("handlePunch — valid transitions call the API and format the result", () => {
  it("clocks in from 'out' and reports success with the recorded time", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "out", lastPunch: null });
    const punch = vi.fn().mockResolvedValue({ id: "p1", kind: "clock_in", occurredAt: 60 }); // 1970-01-01 00:60min → JST 09:01
    const client = fakeClient({ getStatus, punch });

    const result = await handlePunch(client, { kind: "clock_in" });

    expect(punch).toHaveBeenCalledWith({ kind: "clock_in" });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/打刻しました/);
    expect(textOf(result)).toMatch(/出勤/);
    expect(textOf(result)).toMatch(/修正申請/);
  });

  it("propagates a KizamiApiError's human-readable message unchanged when punch itself fails", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "out", lastPunch: null });
    const punch = vi.fn().mockRejectedValue(new KizamiApiError("その月は既に締められています。", 409, "month_closed"));
    const client = fakeClient({ getStatus, punch });

    await expect(handlePunch(client, { kind: "clock_in" })).rejects.toThrow(/締められています/);
  });
});

describe("handleGetStatus", () => {
  it("reports the current state, last punch, and today's punches", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "working", lastPunch: { kind: "clock_in", occurredAt: 0 } });
    const listPunches = vi.fn().mockResolvedValue([{ id: "p1", kind: "clock_in", occurredAt: 0 }]);
    const client = fakeClient({ getStatus, listPunches });

    const result = await handleGetStatus(client);

    expect(listPunches).toHaveBeenCalledTimes(1);
    const [arg] = listPunches.mock.calls[0] as [{ from: number; to: number }];
    expect(arg.to - arg.from).toBe(1439); // ちょうど1日分の窓
    expect(textOf(result)).toMatch(/勤務中/);
    expect(textOf(result)).toMatch(/出勤/);
  });

  it("reports no punches gracefully when today has none", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "out", lastPunch: null });
    const listPunches = vi.fn().mockResolvedValue([]);
    const client = fakeClient({ getStatus, listPunches });

    const result = await handleGetStatus(client);

    expect(textOf(result)).toMatch(/勤務外/);
    expect(textOf(result)).toMatch(/打刻がありません/);
  });
});

describe("handleGetMonthlySummary", () => {
  it("formats totals, flex balance, and passes the requested month through", async () => {
    const getMonthlySummary = vi.fn().mockResolvedValue({
      days: [],
      totals: { statutory: 9600, overtime: 120, overtime60h: 0, lateNight: 30, statutoryHoliday: 0 },
      flexBalance: { frameMinutes: 9600, actualMinutes: 9720, diffMinutes: 120 },
      warnings: [],
      closed: false,
      amended: false,
    });
    const client = fakeClient({ getMonthlySummary });

    const result = await handleGetMonthlySummary(client, { month: "2026-07" });

    expect(getMonthlySummary).toHaveBeenCalledWith({ month: "2026-07" });
    const text = textOf(result);
    expect(text).toMatch(/2026-07/);
    expect(text).toMatch(/2時間/); // overtime 120分 = 2時間
    expect(text).toMatch(/超過/); // diffMinutes > 0
  });

  it("defaults to the current JST month when month is omitted (server has no default)", async () => {
    const getMonthlySummary = vi.fn().mockResolvedValue({
      days: [],
      totals: { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 },
      flexBalance: { frameMinutes: 0, actualMinutes: 0, diffMinutes: 0 },
      warnings: [],
      closed: false,
      amended: false,
    });
    const client = fakeClient({ getMonthlySummary });

    await handleGetMonthlySummary(client, {});

    const [arg] = getMonthlySummary.mock.calls[0] as [{ month: string }];
    expect(arg.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("shows warnings with human-readable labels", async () => {
    const getMonthlySummary = vi.fn().mockResolvedValue({
      days: [],
      totals: { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 },
      flexBalance: { frameMinutes: 0, actualMinutes: 0, diffMinutes: 0 },
      warnings: [{ kind: "missing_clock_out", date: "2026-07-05" }],
      closed: false,
      amended: false,
    });
    const client = fakeClient({ getMonthlySummary });

    const result = await handleGetMonthlySummary(client, {});

    expect(textOf(result)).toMatch(/退勤打刻が無いまま/);
  });

  it("marks the summary as closed / amended and shows the before-after diff", async () => {
    const getMonthlySummary = vi.fn().mockResolvedValue({
      days: [],
      totals: { statutory: 9600, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 },
      flexBalance: { frameMinutes: 9600, actualMinutes: 9600, diffMinutes: 0 },
      warnings: [],
      closed: true,
      amended: true,
      originalTotals: { statutory: 9500, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0 },
      originalFlexBalance: { frameMinutes: 9600, actualMinutes: 9500, diffMinutes: -100 },
    });
    const client = fakeClient({ getMonthlySummary });

    const result = await handleGetMonthlySummary(client, {});

    const text = textOf(result);
    expect(text).toMatch(/締め済み/);
    expect(text).toMatch(/締め後修正あり/);
    expect(text).toMatch(/当初確定値との差分/);
  });
});

describe("handleGetLeaveBalance", () => {
  it("formats annual/stocked balances as days and the mandatory-5-days status", async () => {
    const getLeaveBalance = vi.fn().mockResolvedValue({
      standardDayMinutes: 480,
      annual: { totalGrantedMinutes: 4800, usedMinutes: 960, remainingMinutes: 3840 },
      stocked: { totalGrantedMinutes: 0, usedMinutes: 0, remainingMinutes: 0 },
      mandatoryFiveDays: [
        { grantId: "g1", periodStart: "2025-04-01", periodEnd: "2026-04-01", taken: 2, required: 5, shortage: 3, deadline: "2026-04-01", satisfied: false },
      ],
    });
    const client = fakeClient({ getLeaveBalance });

    const result = await handleGetLeaveBalance(client);
    const text = textOf(result);

    expect(text).toMatch(/8\.0日/); // 3840 / 480 = 8.0
    expect(text).toMatch(/不足 3日/);
  });
});

describe("handleListCorrections", () => {
  it("reports 'no pending requests' distinctly from an empty 'all' listing", async () => {
    const listCorrections = vi.fn().mockResolvedValue([]);
    const client = fakeClient({ listCorrections });

    const pendingResult = await handleListCorrections(client, {});
    expect(textOf(pendingResult)).toMatch(/承認待ちの修正申請はありません/);

    const allResult = await handleListCorrections(client, { status: "all" });
    expect(textOf(allResult)).toMatch(/修正申請はありません/);
  });

  it("describes a correction (訂正), passing the requested status through to the client", async () => {
    const listCorrections = vi.fn().mockResolvedValue([
      {
        id: "c1",
        status: "pending",
        targetEventId: "e1",
        targetPunch: { kind: "clock_in", occurredAt: 0 },
        proposedKind: "clock_in",
        proposedOccurredAt: 10,
        reason: "打刻し忘れたため",
        decidedAt: null,
        decisionNote: null,
        createdAt: 5,
      },
    ]);
    const client = fakeClient({ listCorrections });

    const result = await handleListCorrections(client, { status: "all" });

    expect(listCorrections).toHaveBeenCalledWith({ status: "all" });
    const text = textOf(result);
    expect(text).toMatch(/承認待ち/);
    expect(text).toMatch(/訂正/);
    expect(text).toMatch(/打刻し忘れたため/);
  });

  it("describes an addition (追加) and a cancellation (取消) distinctly", async () => {
    const listCorrections = vi.fn().mockResolvedValue([
      {
        id: "c-add",
        status: "approved",
        targetEventId: null,
        targetPunch: null,
        proposedKind: "break_start",
        proposedOccurredAt: 30,
        reason: "休憩の打刻漏れ",
        decidedAt: 40,
        decisionNote: null,
        createdAt: 20,
      },
      {
        id: "c-void",
        status: "approved",
        targetEventId: "e2",
        targetPunch: { kind: "clock_out", occurredAt: 500 },
        proposedKind: null,
        proposedOccurredAt: null,
        reason: "誤打刻の取消",
        decidedAt: 510,
        decisionNote: "確認済み",
        createdAt: 500,
      },
    ]);
    const client = fakeClient({ listCorrections });

    const result = await handleListCorrections(client, { status: "all" });
    const text = textOf(result);

    expect(text).toMatch(/追加/);
    expect(text).toMatch(/取消/);
    expect(text).toMatch(/確認済み/);
  });
});
