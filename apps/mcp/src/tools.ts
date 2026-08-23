/**
 * MCP ツールの実体。SDK(@modelcontextprotocol/sdk)への依存は registerTools() 内に閉じ込め、
 * handle* 関数自体は KizamiApiClient だけに依存する薄いロジックとしてテストしやすくする。
 *
 * 依頼により意図的に提供しないツール:
 * - 修正申請の作成(create_correction)・承認・却下・取下げ — 申請は理由を伴う人間の判断で
 *   あり、AIに任せるべきではないため(README.md にも明記)
 * - 承認・締め・テナント設定変更 — そもそもAPIキーのスコープ上できないが、ツールとしても
 *   一切定義しない(依頼: 「ツールとしても出さない」)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { KizamiApiError, type KizamiApiClient } from "./client.js";
import type { CorrectionRequestDto, PunchKind } from "./types.js";
import { formatDuration, formatTimestamp, punchKindLabel, stateLabel, correctionStatusLabel, warningLabel } from "./format.js";
import { describeInvalidPunchTransition, isValidPunchTransition } from "./punch-transition.js";
import { currentJstMonth, jstCalendarDayWindow, nowMinutes } from "./time.js";

/** MCP の `tools/call` レスポンス型そのもの(SDKの CallToolResult の別名。テストからも参照する)。 */
export type ToolTextResult = CallToolResult;

function textResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolTextResult {
  return { content: [{ type: "text", text }], isError: true };
}

const PUNCH_KINDS = ["clock_in", "clock_out", "break_start", "break_end"] as const satisfies readonly PunchKind[];

// ---- punch ----

export interface PunchArgs {
  kind: PunchKind;
}

/**
 * 打刻する。依頼どおり「現在の状態を確認してから実行」し、無効な遷移は実行前(=API呼び出し前)
 * にエラーを返す。API側の生のエラーコードをそのまま返すことはしない。
 */
export async function handlePunch(client: KizamiApiClient, args: PunchArgs): Promise<ToolTextResult> {
  const status = await client.getStatus();
  if (!isValidPunchTransition(status.state, args.kind)) {
    return errorResult(describeInvalidPunchTransition(status.state, args.kind));
  }

  const punch = await client.punch({ kind: args.kind });
  const lines = [
    `打刻しました: ${punchKindLabel(punch.kind)}(${formatTimestamp(punch.occurredAt)})`,
    "この打刻はKIZAMIに実際に記録されました。取り消す場合はKIZAMIの画面から修正申請を行ってください(このMCPサーバーからは取り消せません)。",
  ];
  return textResult(lines.join("\n"));
}

// ---- get_status ----

/** 現在の勤務状態と、今日(JST暦日ベースの概算)の打刻一覧を返す。 */
export async function handleGetStatus(client: KizamiApiClient): Promise<ToolTextResult> {
  const status = await client.getStatus();
  const { from, to } = jstCalendarDayWindow(nowMinutes());
  const todaysPunches = await client.listPunches({ from, to });

  const lines = [`現在の状態: ${stateLabel(status.state)}`];
  if (status.lastPunch) {
    lines.push(`直近の打刻: ${punchKindLabel(status.lastPunch.kind)}(${formatTimestamp(status.lastPunch.occurredAt)})`);
  } else {
    lines.push("直近の打刻はありません。");
  }
  lines.push("");
  lines.push(`今日の打刻一覧(${todaysPunches.length}件、JST 0時基準の概算です。日界を0時以外に設定している場合はKIZAMI画面の表示とずれることがあります):`);
  if (todaysPunches.length === 0) {
    lines.push("(打刻がありません)");
  } else {
    for (const p of todaysPunches) {
      lines.push(`- ${formatTimestamp(p.occurredAt)}  ${punchKindLabel(p.kind)}`);
    }
  }
  return textResult(lines.join("\n"));
}

// ---- get_monthly_summary ----

export interface MonthlySummaryArgs {
  month?: string | undefined;
}

export async function handleGetMonthlySummary(client: KizamiApiClient, args: MonthlySummaryArgs): Promise<ToolTextResult> {
  // GET /attendance/monthly はサーバー側で month を必須にしている(省略時の既定値を持たない)。
  // 「引数省略時は当月」という依頼の契約を満たすため、ここで当月(JST)を計算して明示的に渡す。
  const month = args.month ?? currentJstMonth();
  const summary = await client.getMonthlySummary({ month });
  const { totals, flexBalance, original } = summary.figures;

  const headerFlags = [summary.closing.closed ? "締め済み" : null, summary.closing.amended ? "締め後修正あり" : null].filter(
    (v): v is string => v !== null,
  );
  const header = `月次集計(${month})${headerFlags.length > 0 ? `  [${headerFlags.join(" / ")}]` : ""}`;

  const lines = [header, ""];
  lines.push("■ 実労働時間の内訳");
  lines.push(`  法定内: ${formatDuration(totals.statutory)}`);
  lines.push(`  時間外(残業): ${formatDuration(totals.overtime)}`);
  lines.push(`  時間外(月60時間超): ${formatDuration(totals.overtime60h)}`);
  lines.push(`  深夜: ${formatDuration(totals.lateNight)}`);
  lines.push(`  法定休日労働: ${formatDuration(totals.statutoryHoliday)}`);

  // 固定時間制の月は flexBalance が null(依頼どおり — フレックスにのみ意味がある値)。
  if (flexBalance) {
    lines.push("");
    lines.push("■ フレックス収支");
    lines.push(`  枠: ${formatDuration(flexBalance.frameMinutes)}`);
    lines.push(`  実績: ${formatDuration(flexBalance.actualMinutes)}`);
    const diffSuffix = flexBalance.diffMinutes < 0 ? "(不足)" : flexBalance.diffMinutes > 0 ? "(超過)" : "";
    lines.push(`  過不足: ${formatDuration(flexBalance.diffMinutes)}${diffSuffix}`);
  }

  if (summary.warnings.length > 0) {
    lines.push("");
    lines.push(`■ 警告(${summary.warnings.length}件、打刻データの解釈に関する注意です)`);
    for (const w of summary.warnings) {
      lines.push(`  - ${w.date}: ${warningLabel(w.kind)}`);
    }
  }

  if (summary.closing.amended && original) {
    lines.push("");
    lines.push("■ 締め後修正: 当初確定値との差分");
    lines.push(`  法定内: ${formatDuration(original.totals.statutory)} → ${formatDuration(totals.statutory)}`);
    lines.push(`  時間外: ${formatDuration(original.totals.overtime)} → ${formatDuration(totals.overtime)}`);
    if (original.flexBalance && flexBalance) {
      lines.push(`  フレックス過不足: ${formatDuration(original.flexBalance.diffMinutes)} → ${formatDuration(flexBalance.diffMinutes)}`);
    }
  }

  return textResult(lines.join("\n"));
}

// ---- get_leave_balance ----

export async function handleGetLeaveBalance(client: KizamiApiClient): Promise<ToolTextResult> {
  const balance = await client.getLeaveBalance();
  const dayMinutes = balance.standardDayMinutes;
  const toDays = (minutes: number) => (dayMinutes > 0 ? (minutes / dayMinutes).toFixed(1) : "?");

  const lines = ["■ 有給休暇の残高(日数は所定労働時間換算の概算です)"];
  lines.push(
    `  年次有給休暇: 残り ${toDays(balance.annual.remainingMinutes)}日(付与 ${toDays(balance.annual.totalGrantedMinutes)}日 / 消化 ${toDays(balance.annual.usedMinutes)}日)`,
  );
  lines.push(
    `  積立休暇: 残り ${toDays(balance.stocked.remainingMinutes)}日(付与 ${toDays(balance.stocked.totalGrantedMinutes)}日 / 消化 ${toDays(balance.stocked.usedMinutes)}日)`,
  );
  lines.push("");

  if (balance.mandatoryFiveDays.length === 0) {
    lines.push("■ 年5日取得義務: 対象となる付与がありません。");
  } else {
    lines.push("■ 年5日取得義務の状況");
    for (const m of balance.mandatoryFiveDays) {
      const state = m.satisfied ? "達成済み" : `不足 ${m.shortage}日`;
      lines.push(`  ${m.periodStart} 〜 ${m.periodEnd}(期限: ${m.deadline}): 取得 ${m.taken}日 / 必要 ${m.required}日(${state})`);
    }
  }

  return textResult(lines.join("\n"));
}

// ---- list_corrections ----

export interface ListCorrectionsArgs {
  status?: "pending" | "all" | undefined;
}

function describeCorrectionContent(r: CorrectionRequestDto): string {
  const hasProposed = r.proposedKind !== null && r.proposedOccurredAt !== null;
  if (r.targetEventId && hasProposed) {
    const before = r.targetPunch ? `${punchKindLabel(r.targetPunch.kind)}(${formatTimestamp(r.targetPunch.occurredAt)})` : "(元の打刻不明)";
    const after = `${punchKindLabel(r.proposedKind as string)}(${formatTimestamp(r.proposedOccurredAt as number)})`;
    return `訂正: ${before} → ${after}`;
  }
  if (!r.targetEventId && hasProposed) {
    return `追加: ${punchKindLabel(r.proposedKind as string)}(${formatTimestamp(r.proposedOccurredAt as number)})`;
  }
  if (r.targetEventId && !hasProposed) {
    const target = r.targetPunch ? `${punchKindLabel(r.targetPunch.kind)}(${formatTimestamp(r.targetPunch.occurredAt)})` : "(元の打刻不明)";
    return `取消: ${target}`;
  }
  return "(内容不明の申請)";
}

export async function handleListCorrections(client: KizamiApiClient, args: ListCorrectionsArgs): Promise<ToolTextResult> {
  const requests = await client.listCorrections({ status: args.status });
  if (requests.length === 0) {
    return textResult(args.status === "all" ? "修正申請はありません。" : "承認待ちの修正申請はありません。");
  }

  const lines = [`修正申請一覧(${requests.length}件):`, ""];
  for (const r of requests) {
    lines.push(`- [${correctionStatusLabel(r.status)}] ${describeCorrectionContent(r)}`);
    lines.push(`  理由: ${r.reason}`);
    lines.push(`  申請日時: ${formatTimestamp(r.createdAt)}`);
    if (r.decidedAt !== null) {
      const noteSuffix = r.decisionNote ? `(メモ: ${r.decisionNote})` : "";
      lines.push(`  決定日時: ${formatTimestamp(r.decidedAt)}${noteSuffix}`);
    }
    lines.push("");
  }
  return textResult(lines.join("\n").trimEnd());
}

// ---- registration ----

function withErrorHandling<Args>(
  client: KizamiApiClient,
  handler: (client: KizamiApiClient, args: Args) => Promise<ToolTextResult>,
): (args: Args) => Promise<ToolTextResult> {
  return async (args: Args) => {
    try {
      return await handler(client, args);
    } catch (err) {
      if (err instanceof KizamiApiError) {
        return errorResult(err.message);
      }
      throw err;
    }
  };
}

export function registerTools(server: McpServer, client: KizamiApiClient): void {
  server.registerTool(
    "punch",
    {
      title: "打刻する",
      description:
        "出勤・退勤・休憩開始・休憩終了のいずれかを打刻します。この打刻は実際にKIZAMIに記録され、監査ログにも残ります。" +
        "取り消すにはKIZAMIの画面から修正申請を行う必要があります(このツールに取り消し機能はありません)。" +
        "実行前に現在の勤務状態(勤務外/勤務中/休憩中)を自動的に確認し、その状態で無効な遷移(例: 勤務外の状態での退勤、" +
        "勤務中の状態での再度の出勤)である場合は、APIを呼び出さずにエラーメッセージを返します。",
      inputSchema: { kind: z.enum(PUNCH_KINDS) },
    },
    withErrorHandling(client, handlePunch),
  );

  server.registerTool(
    "get_status",
    {
      title: "現在の勤務状態を確認する",
      description:
        "現在の勤務状態(勤務外/勤務中/休憩中)、直近の打刻、および今日の打刻一覧を参照専用で取得します。書き込みは行いません。",
      inputSchema: {},
    },
    withErrorHandling(client, (c) => handleGetStatus(c)),
  );

  server.registerTool(
    "get_monthly_summary",
    {
      title: "月次の勤怠集計を確認する",
      description:
        "指定した月(省略時は当月)の実労働時間・時間外(残業)・深夜労働・フレックス収支・警告(打刻データの不整合)を参照専用で取得します。" +
        "対象月が締め済みの場合はその旨、締め後に修正が入っている場合は当初確定値との差分も表示します。",
      inputSchema: { month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM 形式で指定してください").optional() },
    },
    withErrorHandling(client, handleGetMonthlySummary),
  );

  server.registerTool(
    "get_leave_balance",
    {
      title: "有給休暇の残高を確認する",
      description: "年次有給休暇・積立休暇の残高と、年5日取得義務の充足状況を参照専用で取得します。",
      inputSchema: {},
    },
    withErrorHandling(client, (c) => handleGetLeaveBalance(c)),
  );

  server.registerTool(
    "list_corrections",
    {
      title: "打刻修正申請の一覧を確認する",
      description:
        "打刻の修正申請(訂正・追加・取消)の一覧を参照専用で取得します。既定では承認待ちのみ、status='all' で全ステータスを取得できます。" +
        "このツールは参照のみです。修正申請の作成・承認・却下・取下げはできません" +
        "(申請は理由を伴う人間の判断であり、意図的にこのMCPサーバーの対象外としています。KIZAMIの画面から行ってください)。",
      inputSchema: { status: z.enum(["pending", "all"]).optional() },
    },
    withErrorHandling(client, handleListCorrections),
  );
}
