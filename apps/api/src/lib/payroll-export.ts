/**
 * 給与ソフト向けエクスポート形式(freee人事労務 / マネーフォワード クラウド給与)の
 * 列マッピングを1箇所に集約するモジュール(2026-08-27 追加)。
 *
 * KIZAMI の出口は要件 §1 のとおり**区分別時間数まで**で、割増率を掛けた金額計算は給与ソフト側の
 * 責任(docs/requirements.md「集計の出口は時間区分の算出まで」)。ここで行うのは
 * 「KIZAMI の区分 → 給与ソフトの勤怠列」の名前と単位の変換だけで、金額は一切計算しない。
 *
 * 検証状況(2026-08-27 調査。出典URLと詳細は docs/design/payroll-export.md):
 * - **freee人事労務**: 列仕様は公開されている。ヘルプ「他社サービスの勤怠データを取り込む
 *   (インポート)」(https://support.freee.co.jp/hc/ja/articles/204922194)の項目表と、同記事から
 *   配布されているサンプル `【サンプル】勤怠_freee形式.csv`
 *   (https://support.freee.co.jp/hc/ja/article_attachments/53271056075161)のヘッダ行から
 *   24列・全て分単位の整数であることを確認済み。ただし KIZAMI が算出しない日数系の列
 *   (総労働日数・欠勤日数・有休取得日数等)があり、そこは空欄で出す(下記 FREEE_COLUMNS 参照)。
 * - **マネーフォワード クラウド給与**: **固定の列仕様は存在しない**。ヘルプ「他社ソフトから
 *   CSVインポートで勤怠データを取り込む方法」(https://biz.moneyforward.com/support/payroll/guide/integrations/in09.html)
 *   のとおり、CSV のタイトル行の文字列を**その事業者が「勤怠項目設定」に登録した項目名**と
 *   一致させる方式で、項目名も単位も会社ごとに違う。したがって mf 形式は
 *   **「そのまま取り込める公式フォーマット」ではなく、MF のテンプレートへ転記するための
 *   「マッピング確認用CSV」(β)**である。
 *
 * ⚠ どちらの形式も**取り込み前にテンプレート・勤怠項目設定との突き合わせが必須**。
 * 誤ったマッピングは誤った賃金計算に直結するため、確認できていないことをここで断定しない。
 *
 * 設計:
 * - 列の定義(名前・順序・単位・エンコーディング)は本ファイルの PAYROLL_FORMAT_SPECS だけに置く。
 *   ルート(routes/exports.ts)は「区分別時間数を集めて spec に渡す」だけにして、形式ごとの
 *   分岐がルートへ漏れないようにする(単体テストで列を固定できるようにするため)。
 * - 汎用CSV(generic)は従来どおり routes/exports.ts が組み立てる。generic は KIZAMI 自身の
 *   スキーマ(分単位・スネークケース英語・手当の動的列)であり、給与ソフト形式とは
 *   「列が固定か動的か」という性質が違うため、無理に同じ spec 構造へ寄せていない。
 */

import type { CategorizedMinutes, FlexBalance } from "@kizami/engine";

/** `?format=` で受け付ける値。 */
export const EXPORT_FORMATS = ["generic", "freee", "mf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** 給与ソフト向け形式(generic 以外)。PAYROLL_FORMAT_SPECS のキー。 */
export type PayrollExportFormat = Exclude<ExportFormat, "generic">;

/**
 * `?format=` を解釈する。未指定は "generic"(既存の挙動を変えないため)。
 * 未知の値は null を返し、呼び出し側が 400 にする(黙って generic に落とすと、
 * 綴り間違いに気づかないまま「取り込めない CSV」を渡してしまうため)。
 */
export function parseExportFormat(raw: string | undefined): ExportFormat | null {
  if (raw === undefined || raw === "") return "generic";
  return (EXPORT_FORMATS as readonly string[]).includes(raw) ? (raw as ExportFormat) : null;
}

/**
 * 1ユーザー・1ヶ月分の区分別時間数(routes/exports.ts の MonthlyFigures から必要な分だけ抜いたもの)。
 * 締め済み月はスナップショット由来、未締め月は engine の計算結果由来で、どちらも同じ形になる。
 */
export interface PayrollFigures {
  totals: CategorizedMinutes;
  /** フレックス以外(固定時間制・シフト制、または締め時点で flex 行が無い)なら null */
  flexBalance: FlexBalance | null;
  workSystem: "flex" | "fixed" | "monthly_variable";
  /** 固定時間制のみ。所定内労働時間の月合計（分） */
  fixedWithinScheduledMinutes: number | null;
  /** 固定時間制のみ。法定内残業(所定超〜法定8h以内)の月合計（分） */
  fixedExtraWithinStatutoryMinutes: number | null;
}

/**
 * 給与ソフトが共通して欲しがる粒度に整えた区分（分）。
 *
 * KIZAMI の CategorizedMinutes をそのまま渡せない理由:
 * - `totals.overtime` は**60時間超の分を含んだ**法定時間外の総計で、`totals.overtime60h` は
 *   そのうちの60時間超部分(packages/engine/src/{flex,fixed,variable}.ts — overtime60h は
 *   `max(0, overtime - 閾値)` として overtime から導出される)。給与ソフトは割増率が違う
 *   「25%以上の時間外」と「50%以上の時間外」を別列で欲しがるため、
 *   `overtimeUpTo60hMinutes = overtime - overtime60h` に割り直す。ここを取り違えると
 *   60時間超部分を二重に支払う/払い漏らすことになるため、変換はこの1箇所に閉じる。
 * - `totals.statutory` は「所定内 + 法定内残業」の合計で、給与計算では基本給の範囲(所定内)と
 *   割増なしの時間外(法定内残業)を分ける必要がある(closing-snapshot.ts の FixedBreakdownTotals
 *   参照)。固定時間制はその内訳を持っているのでそれを使う。
 */
export interface PayrollCategories {
  /** 所定内労働時間 */
  withinScheduledMinutes: number;
  /** 法定内残業(所定外だが法定8h以内。割増なし) */
  extraWithinStatutoryMinutes: number;
  /** 法定時間外のうち月60時間以下の部分(割増25%以上) */
  overtimeUpTo60hMinutes: number;
  /** 法定時間外のうち月60時間超の部分(割増50%以上、労基法37条1項ただし書) */
  overtimeOver60hMinutes: number;
  /** 深夜(22:00〜翌5:00)。他区分と重複しうる独立の加算区分 */
  lateNightMinutes: number;
  /** 法定休日労働(割増35%以上)。上記の労働時間には含まれない */
  statutoryHolidayMinutes: number;
}

/**
 * KIZAMI の区分別時間数を、給与ソフト向けの粒度へ割り直す。
 *
 * 労働時間制ごとの扱い(判断点):
 * - **固定時間制**: 所定内 / 法定内残業の内訳をそのまま使う。
 * - **フレックス**: 日ごとの「所定」という概念が無く、清算期間の総枠との差分だけで時間外が決まる
 *   (docs/design/work-systems.md)。総枠内の労働(= `totals.statutory`)が実質的に所定内に
 *   あたるため、**所定内 = totals.statutory / 法定内残業 = 0** として出す。フレックスに
 *   「法定内残業」に相当する区分は存在しない(総枠を超えた瞬間に法定時間外になる)。
 * - **シフト制(monthly_variable)**: 内訳を持たない(routes/exports.ts の MonthlyFigures 参照)。
 *   フレックスと同じく totals.statutory を丸ごと所定内として出す。変形労働の期間時間外は
 *   既に `totals.overtime` に含まれている。
 *
 * どの制度でも「所定内 + 法定内残業 = totals.statutory」「60h以下 + 60h超 = totals.overtime」が
 * 保たれる(単体テストで固定している)。
 */
export function derivePayrollCategories(figures: PayrollFigures): PayrollCategories {
  const { totals } = figures;
  const withinScheduled = figures.fixedWithinScheduledMinutes;
  const extraWithinStatutory = figures.fixedExtraWithinStatutoryMinutes;
  const hasFixedBreakdown = withinScheduled !== null && extraWithinStatutory !== null;

  return {
    withinScheduledMinutes: hasFixedBreakdown ? withinScheduled : totals.statutory,
    extraWithinStatutoryMinutes: hasFixedBreakdown ? extraWithinStatutory : 0,
    // overtime60h は overtime の部分集合(上記 JSDoc 参照)。負にならないよう max を噛ませる
    // (法令版の切り替わり等で理論上ずれた場合でも「時間外がマイナス」という不正な CSV を出さない)。
    overtimeUpTo60hMinutes: Math.max(0, totals.overtime - totals.overtime60h),
    overtimeOver60hMinutes: totals.overtime60h,
    lateNightMinutes: totals.lateNight,
    statutoryHolidayMinutes: totals.statutoryHoliday,
  };
}

/**
 * 分 → "H:MM"(時:分)。負値は先頭に "-" を付ける(締め後修正の差分では使わないが、
 * 将来 diff 列を足したときに黙って壊れないよう最初から扱っておく)。
 * 24時間を超えても日数に繰り上げず、通算の時間数で出す(月合計を1セルで表すため)。
 */
export function formatHoursMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}`;
}

/**
 * 分 → 十進時間(小数第2位まで、例: 90分 → "1.50")。
 *
 * 四捨五入は行うが**丸め幅は変えない**(15分単位等への丸めは賃金の切り捨てになりうるため、
 * KIZAMI 側では絶対に行わない — docs/guide/attendance-minute-unit.md の方針)。
 * 小数第2位でも 1分 = 0.0166… は割り切れず、120分の1時間単位で最大 0.3 秒の誤差が出る。
 * この誤差が許容できない場合は時:分形式を使うこと。
 */
export function formatDecimalHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

/**
 * フレックスの不足時間（分）。清算期間の総枠に足りなかった分を正の数で返す。
 * フレックス以外(内訳を持たない)では null。
 */
function flexShortageMinutes(figures: PayrollFigures): number | null {
  if (figures.flexBalance === null) return null;
  return Math.max(0, -figures.flexBalance.diffMinutes);
}

/** 1ユーザー・1ヶ月分の行を組み立てるための入力。 */
export interface PayrollRowInput {
  /**
   * 従業員のメールアドレス。**従業員番号の列に入れる**(users に社員番号のフィールドが無いため —
   * 判断の理由は routes/exports.ts の renderPayrollCsv と docs/design/payroll-export.md
   * 「従業員の識別子」)。
   */
  email: string;
  name: string;
  /** "YYYY-MM" */
  period: string;
  /** 集計開始日 "YYYY-MM-DD"(= 月初) */
  periodStartDate: string;
  /** 集計終了日 "YYYY-MM-DD"(= 月末) */
  periodEndDate: string;
  figures: PayrollFigures;
}

export interface PayrollFormatSpec {
  /** CSV のタイトル行。列順もこの配列で固定する。 */
  readonly header: readonly string[];
  /** header と同じ長さ・同じ並びのフィールドを返す。空文字は「KIZAMI が算出しない項目」の意味。 */
  buildRow(input: PayrollRowInput): string[];
}

/**
 * freee人事労務「勤怠サマリー」インポートの24列(サンプルCSVのヘッダ行そのまま。
 * 括弧は**全角**「（分）」であることに注意 — 半角に直すと項目名が一致しない)。
 *
 * KIZAMI が値を入れる列と入れない列:
 * - 時間の列はすべて埋まる(KIZAMI の出口である区分別時間数そのもの)
 * - **日数系の列(総労働日数・所定労働出勤日数・所定休日出勤日数・法定休日出勤日数・
 *   欠勤日数・遅刻日数・早退日数・有休取得日数)と遅刻/早退時間は空欄で出す**。KIZAMI は
 *   これらを集計の出口として持たない(締めスナップショットにも日数は保存していない)。
 *   freee 側は空欄を 0 として扱うため、**空欄のまま取り込むと日割り計算・欠勤控除を誤る**。
 *   0 を書かず空欄にしているのは、表計算で開いたときに「未入力」であることが人の目に
 *   分かるようにするため(0 は「実績なし」という意思表示に見えてしまう)。
 *   UI とドキュメントで補完を促している。
 * - `所定休日労働時間（分）` は空欄。KIZAMI は所定休日(法定休日でない休日)の労働を独立した
 *   区分として持たず、通常の労働時間・時間外に含めて集計している(この列に値を入れると
 *   時間外側と二重計上になる)。freee のサンプルCSVのデータ行でもこの列は空。
 * - `みなし外の…`(裁量労働制)は KIZAMI が裁量労働制を扱わないため常に空欄。
 */
const FREEE_COLUMNS = [
  "従業員番号",
  "氏名",
  "所定労働時間（分）",
  "法定内残業時間（分）",
  "時間外労働時間（分）",
  "所定休日労働時間（分）",
  "深夜労働時間（分）",
  "法定休日労働時間（分）",
  "総労働時間（分）",
  "総労働日数",
  "所定労働出勤日数",
  "所定休日出勤日数",
  "法定休日出勤日数",
  "遅刻時間（分）",
  "早退時間（分）",
  "欠勤日数",
  "遅刻日数",
  "早退日数",
  "有休取得日数",
  "集計開始日",
  "集計終了日",
  "みなし外の法定内残業時間（分）",
  "みなし外の時間外労働時間（分）",
  "不足時間（分）",
] as const;

/**
 * マネーフォワード クラウド給与への転記用の列。
 *
 * MF は「CSV のタイトル行 = その事業者の勤怠項目名」で突き合わせる方式のため、**万人に正しい
 * 列名は存在しない**(モジュール冒頭の検証状況参照)。ここでは
 * 「MF の既定の勤怠項目名と1:1で対応づけられると確認できたものはその名前を使い、
 *  対応づけられないものは KIZAMI の区分名をそのまま出す」という方針を採る。
 * 後者は MF 側で同名の勤怠項目を追加するか、転記時に按分する必要がある。
 *
 * | 列 | MF の既定勤怠項目か | 備考 |
 * | --- | --- | --- |
 * | 従業員番号 | ○(インポートCSVの必須列) | KIZAMI はメールアドレスを入れる |
 * | 氏名 / 対象年月 | ✕(参考情報) | 転記時の目印。取り込み前に削除する |
 * | 所定内出勤時間 | ○ | |
 * | 法定内残業時間 | ○ | |
 * | 残業時間 | ○ | MF の「法定外時間」に相当 |
 * | 60時間超残業時間 | ✕ | MF の既定項目に無い。割増50%用に勤怠項目を追加して対応する |
 * | 深夜労働時間 | ✕ | MF は深夜を平日/所定休日/法定休日 × 所定/所定外/法定外に細分するが、 |
 * |  |  | KIZAMI は深夜を単一の合計でしか持たない(法定の割増計算にはそれで足りる) |
 * | 法定休日労働時間 | ✕ | MF は法定休日を5項目に細分する。KIZAMI は単一の合計 |
 *
 * **60時間超の扱いが freee と逆**である点に注意: freee には60時間超の列が無いので
 * `時間外労働時間（分）` に**60時間超を含めた総額**を入れる(freee 側で分解される)。MF は
 * 60時間超を別項目にする運用のため、`残業時間` は**60時間以下の分だけ**にして超過分を
 * 別列に出す。二重計上を防ぐこの非対称性は単体テストで固定している。
 */
const MF_COLUMNS = [
  "従業員番号",
  "氏名",
  "対象年月",
  "所定内出勤時間",
  "法定内残業時間",
  "残業時間",
  "60時間超残業時間",
  "深夜労働時間",
  "法定休日労働時間",
] as const;

export const PAYROLL_FORMAT_SPECS: Record<PayrollExportFormat, PayrollFormatSpec> = {
  freee: {
    header: FREEE_COLUMNS,
    buildRow(input) {
      const c = derivePayrollCategories(input.figures);
      // freee の「総労働時間（分）」の定義はヘルプ記載どおり
      // 「所定労働時間、法定内残業時間、時間外労働時間、法定休日労働時間の合計」。
      // KIZAMI 側の別の合計値(実労働など)ではなく、この定義のとおり足す
      // (深夜は他の列と重複計上する区分なのでここには足さない)。
      const totalWork =
        c.withinScheduledMinutes + c.extraWithinStatutoryMinutes + input.figures.totals.overtime + c.statutoryHolidayMinutes;
      const shortage = flexShortageMinutes(input.figures);
      return [
        input.email,
        input.name,
        String(c.withinScheduledMinutes),
        String(c.extraWithinStatutoryMinutes),
        // 60時間超を含めた法定時間外の総額(freee に60時間超の列は無い)。
        String(input.figures.totals.overtime),
        "", // 所定休日労働時間（分）: KIZAMI は独立区分として持たない
        String(c.lateNightMinutes),
        String(c.statutoryHolidayMinutes),
        String(totalWork),
        "", // 総労働日数
        "", // 所定労働出勤日数
        "", // 所定休日出勤日数
        "", // 法定休日出勤日数
        "", // 遅刻時間（分）
        "", // 早退時間（分）
        "", // 欠勤日数
        "", // 遅刻日数
        "", // 早退日数
        "", // 有休取得日数
        input.periodStartDate,
        input.periodEndDate,
        "", // みなし外の法定内残業時間（分）: 裁量労働制のみ
        "", // みなし外の時間外労働時間（分）: 裁量労働制のみ
        shortage === null ? "" : String(shortage),
      ];
    },
  },
  mf: {
    header: MF_COLUMNS,
    buildRow(input) {
      const c = derivePayrollCategories(input.figures);
      return [
        input.email,
        input.name,
        input.period,
        formatHoursMinutes(c.withinScheduledMinutes),
        formatHoursMinutes(c.extraWithinStatutoryMinutes),
        formatHoursMinutes(c.overtimeUpTo60hMinutes),
        formatHoursMinutes(c.overtimeOver60hMinutes),
        formatHoursMinutes(c.lateNightMinutes),
        formatHoursMinutes(c.statutoryHolidayMinutes),
      ];
    },
  },
};
