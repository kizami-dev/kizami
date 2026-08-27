/**
 * apps/api/src/lib/payroll-export.ts の単体テスト。
 *
 * ここで固定したいのは「KIZAMI の区分 → 給与ソフトの列」の対応そのもの。誤ると賃金計算を
 * 直接誤らせるため、列名・列順・単位・区分の割り当てをすべてリテラルで書き下ろす
 * (定数を import して比較すると、定数を書き換えたときにテストが一緒に通ってしまう)。
 */

import { describe, expect, it } from "vitest";
import type { CategorizedMinutes } from "@kizami/engine";
import {
  derivePayrollCategories,
  formatDecimalHours,
  formatHoursMinutes,
  parseExportFormat,
  PAYROLL_FORMAT_SPECS,
  type PayrollFigures,
  type PayrollRowInput,
} from "../src/lib/payroll-export.js";

function totals(overrides: Partial<CategorizedMinutes> = {}): CategorizedMinutes {
  return { statutory: 0, overtime: 0, overtime60h: 0, lateNight: 0, statutoryHoliday: 0, ...overrides };
}

/** 固定時間制の月(所定内・法定内残業の内訳を持つ)。 */
function fixedFigures(overrides: Partial<PayrollFigures> = {}): PayrollFigures {
  return {
    totals: totals({ statutory: 9600, overtime: 1200, lateNight: 300, statutoryHoliday: 480 }),
    flexBalance: null,
    workSystem: "fixed",
    fixedWithinScheduledMinutes: 9000,
    fixedExtraWithinStatutoryMinutes: 600,
    ...overrides,
  };
}

/** フレックスの月(内訳を持たない)。 */
function flexFigures(overrides: Partial<PayrollFigures> = {}): PayrollFigures {
  return {
    totals: totals({ statutory: 9600, overtime: 1200, lateNight: 300, statutoryHoliday: 480 }),
    flexBalance: { frameMinutes: 10286, actualMinutes: 9600, diffMinutes: -686 },
    workSystem: "flex",
    fixedWithinScheduledMinutes: null,
    fixedExtraWithinStatutoryMinutes: null,
    ...overrides,
  };
}

function rowInput(figures: PayrollFigures): PayrollRowInput {
  return {
    email: "hanako@example.com",
    name: "山田 花子",
    period: "2026-04",
    periodStartDate: "2026-04-01",
    periodEndDate: "2026-04-30",
    figures,
  };
}

describe("parseExportFormat", () => {
  it("未指定・空文字は generic(既存の挙動を変えない)", () => {
    expect(parseExportFormat(undefined)).toBe("generic");
    expect(parseExportFormat("")).toBe("generic");
  });

  it("既知の形式はそのまま返す", () => {
    expect(parseExportFormat("generic")).toBe("generic");
    expect(parseExportFormat("freee")).toBe("freee");
    expect(parseExportFormat("mf")).toBe("mf");
  });

  it("未知の形式は null(黙って generic に落とさない)", () => {
    expect(parseExportFormat("Freee")).toBeNull();
    expect(parseExportFormat("moneyforward")).toBeNull();
  });
});

describe("derivePayrollCategories", () => {
  it("固定時間制: 所定内・法定内残業の内訳をそのまま使う", () => {
    expect(derivePayrollCategories(fixedFigures())).toEqual({
      withinScheduledMinutes: 9000,
      extraWithinStatutoryMinutes: 600,
      overtimeUpTo60hMinutes: 1200,
      overtimeOver60hMinutes: 0,
      lateNightMinutes: 300,
      statutoryHolidayMinutes: 480,
    });
  });

  it("フレックス: 総枠内の労働(statutory)を丸ごと所定内にし、法定内残業は0にする", () => {
    const c = derivePayrollCategories(flexFigures());
    expect(c.withinScheduledMinutes).toBe(9600);
    expect(c.extraWithinStatutoryMinutes).toBe(0);
  });

  it("シフト制(monthly_variable): フレックスと同じく statutory を所定内として出す", () => {
    const c = derivePayrollCategories(
      flexFigures({ workSystem: "monthly_variable", flexBalance: null }),
    );
    expect(c.withinScheduledMinutes).toBe(9600);
    expect(c.extraWithinStatutoryMinutes).toBe(0);
  });

  it("60時間超は overtime の部分集合なので、60h以下 = overtime - overtime60h に割り直す", () => {
    // 時間外 80h(4800分)のうち 60h(3600分)超が 20h(1200分)
    const c = derivePayrollCategories(fixedFigures({ totals: totals({ overtime: 4800, overtime60h: 1200 }) }));
    expect(c.overtimeUpTo60hMinutes).toBe(3600);
    expect(c.overtimeOver60hMinutes).toBe(1200);
    // 二重計上していない(足すと元の総額に戻る)
    expect(c.overtimeUpTo60hMinutes + c.overtimeOver60hMinutes).toBe(4800);
  });

  it("どの制度でも 所定内 + 法定内残業 = totals.statutory が保たれる", () => {
    for (const figures of [fixedFigures(), flexFigures(), flexFigures({ workSystem: "monthly_variable", flexBalance: null })]) {
      const c = derivePayrollCategories(figures);
      expect(c.withinScheduledMinutes + c.extraWithinStatutoryMinutes).toBe(figures.totals.statutory);
    }
  });

  it("深夜・法定休日はそのまま(深夜は他区分と重複する独立の加算区分)", () => {
    const c = derivePayrollCategories(fixedFigures());
    expect(c.lateNightMinutes).toBe(300);
    expect(c.statutoryHolidayMinutes).toBe(480);
  });
});

describe("時間の書式", () => {
  it("formatHoursMinutes は 時:分(分は2桁ゼロ埋め)。24時間を超えても繰り上げない", () => {
    expect(formatHoursMinutes(0)).toBe("0:00");
    expect(formatHoursMinutes(90)).toBe("1:30");
    expect(formatHoursMinutes(9)).toBe("0:09");
    expect(formatHoursMinutes(1500)).toBe("25:00");
    expect(formatHoursMinutes(-90)).toBe("-1:30");
  });

  it("formatDecimalHours は小数第2位まで", () => {
    expect(formatDecimalHours(0)).toBe("0.00");
    expect(formatDecimalHours(90)).toBe("1.50");
    expect(formatDecimalHours(1)).toBe("0.02");
  });
});

describe("freee 形式", () => {
  const spec = PAYROLL_FORMAT_SPECS.freee;

  it("ヘッダは freee のサンプルCSVと同じ24列(括弧は全角)", () => {
    expect(spec.header).toEqual([
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
    ]);
  });

  it("固定時間制の行: 分単位の整数で、日数系と裁量労働制の列は空欄", () => {
    const row = spec.buildRow(rowInput(fixedFigures()));
    expect(row).toHaveLength(spec.header.length);
    expect(row).toEqual([
      "hanako@example.com", // 従業員番号 = メールアドレス(users に社員番号が無いため)
      "山田 花子",
      "9000", // 所定労働時間
      "600", // 法定内残業時間
      "1200", // 時間外労働時間
      "", // 所定休日労働時間: KIZAMI は独立区分として持たない
      "300", // 深夜労働時間
      "480", // 法定休日労働時間
      "11280", // 総労働時間 = 9000 + 600 + 1200 + 480
      "",
      "",
      "",
      "", // 日数系4列
      "",
      "", // 遅刻/早退時間
      "",
      "",
      "",
      "", // 欠勤/遅刻/早退/有休の日数
      "2026-04-01",
      "2026-04-30",
      "",
      "", // みなし外(裁量労働制)
      "", // 不足時間: 固定時間制では空
    ]);
  });

  it("60時間超は分解せず、時間外労働時間に総額を入れる(freee 側に60時間超の列が無いため)", () => {
    const row = spec.buildRow(rowInput(fixedFigures({ totals: totals({ statutory: 9600, overtime: 4800, overtime60h: 1200 }) })));
    expect(row[4]).toBe("4800"); // 60時間超の1200分を含んだ総額
  });

  it("フレックスの不足時間は正の数で出る。超過月は0", () => {
    // diffMinutes = -686(総枠に686分足りない)
    expect(spec.buildRow(rowInput(flexFigures()))[23]).toBe("686");
    const surplus = flexFigures({ flexBalance: { frameMinutes: 10286, actualMinutes: 11000, diffMinutes: 714 } });
    expect(spec.buildRow(rowInput(surplus))[23]).toBe("0");
  });
});

describe("mf 形式", () => {
  const spec = PAYROLL_FORMAT_SPECS.mf;

  it("ヘッダは MF の既定勤怠項目名(対応づけできたもの)+ 参考列", () => {
    expect(spec.header).toEqual([
      "従業員番号",
      "氏名",
      "対象年月",
      "所定内出勤時間",
      "法定内残業時間",
      "残業時間",
      "60時間超残業時間",
      "深夜労働時間",
      "法定休日労働時間",
    ]);
  });

  it("時間は 時:分(60進法)で出す — 十進に丸めて賃金対象時間を削らないため", () => {
    const row = spec.buildRow(rowInput(fixedFigures()));
    expect(row).toEqual([
      "hanako@example.com",
      "山田 花子",
      "2026-04",
      "150:00", // 所定内出勤時間(9000分)
      "10:00", // 法定内残業時間(600分)
      "20:00", // 残業時間(1200分、60時間以下)
      "0:00", // 60時間超残業時間
      "5:00", // 深夜労働時間(300分)
      "8:00", // 法定休日労働時間(480分)
    ]);
  });

  it("60時間超は freee と逆に分解する(残業時間は60時間以下の分だけ)", () => {
    const row = spec.buildRow(rowInput(fixedFigures({ totals: totals({ statutory: 9600, overtime: 4800, overtime60h: 1200 }) })));
    expect(row[5]).toBe("60:00"); // 残業時間 = 3600分
    expect(row[6]).toBe("20:00"); // 60時間超残業時間 = 1200分
  });
});
