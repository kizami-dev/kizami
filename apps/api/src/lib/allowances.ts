/**
 * allowance_definition_versions(DB の JSON 文字列)を engine の AllowanceTimelineSpan[] へ
 * 組み立てる。apps/api/src/lib/settings.ts の buildSettingsTimeline と同じ役割
 * (「effective-dated な DB 行 → engine が受け取れる形」の変換をここに閉じる)。
 */

import { getAllowanceDefinitionVersionsTimeline, type Database, type Transaction } from "@kizami/db";
import type { AllowanceDefinition, AllowanceTimelineSpan } from "@kizami/engine";

export interface BuildAllowanceTimelineParams {
  tenantId: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間初日) */
  fromDate: string;
  /** ローカル日付 "YYYY-MM-DD"(対象期間末日) */
  toDate: string;
}

/**
 * [fromDate, toDate] に関係する手当定義を engine 用 AllowanceTimelineSpan[] へ組み立てる。
 * conditions は DB では JSON 文字列(中身を解釈しない)なので、ここで初めてパースする。
 *
 * `Database | Transaction` を受け取る(buildSettingsTimeline と同じ理由 —
 * apps/api/src/lib/closing-amend.ts が同一トランザクションで月次を再計算するために必要)。
 */
export async function buildAllowanceTimeline(
  db: Database | Transaction,
  params: BuildAllowanceTimelineParams,
): Promise<AllowanceTimelineSpan[]> {
  const rows = await getAllowanceDefinitionVersionsTimeline(db, params);
  return rows.map(
    (row): AllowanceTimelineSpan => ({
      from: row.effectiveFrom,
      definition: {
        id: row.definitionId,
        name: row.name,
        conditions: JSON.parse(row.conditions) as AllowanceDefinition["conditions"],
      },
    }),
  );
}

/**
 * timeline(from 昇順を仮定しない)から、指定ローカル日付に有効な手当定義を全部返す。
 *
 * packages/engine/src/allowances.ts の resolveAllowanceDefinitionsForDate と同じロジックの
 * ローカル再実装。engine パッケージは calculate() と型のみを公開 API とし、内部モジュールは
 * import できない(apps/api/src/lib/settings.ts の standardDayMinutesForDate と同じ判断点 —
 * そちらのコメント参照)。この関数はCSV列名解決・名前マップ構築という「表示用の補助的な解決」に
 * しか使わず、集計そのもの(engine.calculate() の allowanceTotals/DailyBreakdown.allowances)は
 * 変わらず engine 側だけが計算する — ここでの再実装が二重計算の原因にはならない。
 */
function resolveAllowanceDefinitionsForDate(date: string, timeline: AllowanceTimelineSpan[]): AllowanceDefinition[] {
  const chosen = new Map<string, AllowanceTimelineSpan>();
  for (const span of timeline) {
    if (span.from > date) continue;
    const current = chosen.get(span.definition.id);
    if (!current || span.from > current.from) {
      chosen.set(span.definition.id, span);
    }
  }
  return [...chosen.values()].map((span) => span.definition);
}

/**
 * 定義ID → 名前のマップ(GET /attendance/monthly のレスポンスに含める、UI が名前を表示するため)。
 *
 * 「どの時点の名前を使うか」の判断点: 月の途中で手当定義の名前が変わる(版が追加される)ことは
 * ありうるが、この表示用マップは1つの名前しか持てない。ここでは `timeline`(period に関係する
 * 版だけを含む、buildAllowanceTimeline の出力)の中で `from` が最大のもの、つまり
 * 「この期間内で最後に有効になった名前」を採用する — 月次画面は「今この手当が何と呼ばれているか」
 * を示せればよく、月の途中の旧名を出す積極的な理由が無いため(CSVエクスポートは逆に
 * 「期間開始日時点の版」を使う。列名の安定性が目的で意図が異なる — resolveAllowanceColumnsForPeriod
 * 参照)。
 */
export function buildAllowanceNameMap(timeline: AllowanceTimelineSpan[]): Record<string, string> {
  const chosen = new Map<string, AllowanceTimelineSpan>();
  for (const span of timeline) {
    const current = chosen.get(span.definition.id);
    if (!current || span.from > current.from) {
      chosen.set(span.definition.id, span);
    }
  }
  const map: Record<string, string> = {};
  for (const [id, span] of chosen) {
    map[id] = span.definition.name;
  }
  return map;
}

export interface AllowanceColumn {
  definitionId: string;
  name: string;
}

/**
 * CSVエクスポート用: 期間に関係する手当定義の列一覧(docs/design/allowances.md
 * 「CSVエクスポート」— 列名は期間開始日時点の版を使う。定義の追加・削除で列構成が変わることは
 * 避けられないため、取り込み側はヘッダ名で参照すること)。
 *
 * 期間開始日時点でまだ存在しない定義(期間の途中で新設された手当)は「期間開始日時点の名前」が
 * 定義できないため、次善としてその定義が期間内で最初に有効になった版の名前を使う
 * (buildAllowanceNameMap が「最後に有効になった名前」を使うのとは意図的に非対称 — CSV は
 * 列名の一意性・安定性を優先し、月次画面は「今の呼び名」を優先する)。
 *
 * 定義IDの重複が無い前提で1定義=1列。同名の定義が複数存在する場合(改名の前後で同じ名前を
 * 再利用した等)はヘッダが重複しうるが、値の列位置自体は definitionId で一意に決まっているため
 * 実害は無い(依頼どおり「取り込み側はヘッダ名で参照する」ことを明記する運用でカバーする)。
 */
export function resolveAllowanceColumnsForPeriod(timeline: AllowanceTimelineSpan[], periodStartDate: string): AllowanceColumn[] {
  const ids = new Set(timeline.map((span) => span.definition.id));
  const atPeriodStart = new Map(resolveAllowanceDefinitionsForDate(periodStartDate, timeline).map((d) => [d.id, d.name] as const));

  const columns: AllowanceColumn[] = [];
  for (const id of ids) {
    const nameAtPeriodStart = atPeriodStart.get(id);
    if (nameAtPeriodStart !== undefined) {
      columns.push({ definitionId: id, name: nameAtPeriodStart });
      continue;
    }
    const spansForId = timeline.filter((span) => span.definition.id === id).sort((a, b) => (a.from < b.from ? -1 : 1));
    const first = spansForId[0];
    if (first) columns.push({ definitionId: id, name: first.definition.name });
  }
  // definitionId 昇順で並びを決定的にする(CSV の列順がリクエストのたびに変わらないように)。
  return columns.sort((a, b) => (a.definitionId < b.definitionId ? -1 : a.definitionId > b.definitionId ? 1 : 0));
}
