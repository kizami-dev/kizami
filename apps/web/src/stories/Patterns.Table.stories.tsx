import type { Meta, StoryObj } from "@storybook/react";
import { HelpTip } from "../components/HelpTip";
import { messages } from "../lib/messages";
import { formatDateLabel, formatDurationHm } from "../lib/time";

/**
 * 月次テーブルの行の型(components/MonthlyView.tsx の実マークアップ・monthly.css の実クラスを
 * そのまま使う)。「部品抽出のリファクタはしない」方針どおり、tr/td のクラス名・data-label は
 * 実際の JSX と同じ形にする。
 *
 * 勤務列は「1セル(狭いビューポート)」と「出勤・退勤の2列(75rem 以上)」を CSS の
 * display 切り替えだけで排他表示する実装(monthly.css、2026-08-23 決定)なので、両方の
 * td を常に描画する(MonthlyView 本体と同じ構造)。ここを省略すると、広いビューポートで
 * 撮ったスクリーンショットで勤務列が丸ごと消える(実際にこの節を作る過程で踏んだ)。
 *
 * 日付・分数の表示は lib/time.ts の実フォーマッタ(formatDateLabel/formatDurationHm)を使う
 * ため、ロケール切り替えで曜日表記が実際に変わる。出退勤の時刻だけは固定の "HH:mm" 文字列
 * (架空データ)にする — formatTimeJst は「UTC エポック分」を引数に取る変換関数で、この場で
 * それらしい epoch 値を逆算するより素の文字列の方が誤解がない。
 */
interface DemoRow {
  key: string;
  rowClassName?: string;
  date: string;
  clockIn?: string;
  clockOut?: string;
  worked?: number;
  breakMinutes?: number;
  breakAutoMinutes?: number;
  lateNight?: number;
  warningText?: string;
  leaveBadge?: string;
}

/**
 * 行データは(messages 参照を含むため)コンポーネント本体の中で毎回組み立てる。
 * モジュールスコープの定数にすると import 時点(常に既定ロケール "ja")の文言で固定されて
 * しまい、ツールバーでロケールを切り替えても(Story の remount では再評価されないため)
 * 追従しない — 実際にこの節を作る過程で「有給バッジだけ翻訳されない」形で踏んだ。
 */
function buildRows(): DemoRow[] {
  return [
    {
      key: "normal",
      date: "2026-08-03",
      clockIn: "09:00",
      clockOut: "18:00",
      worked: 480,
      breakMinutes: 60,
      lateNight: 0,
    },
    {
      key: "holiday",
      rowClassName: "monthly-table__row--holiday",
      date: "2026-08-04",
      clockIn: "09:00",
      clockOut: "13:00",
      worked: 240,
      breakMinutes: 0,
      lateNight: 0,
    },
    {
      key: "warning",
      rowClassName: "monthly-table__row--warning",
      date: "2026-08-05",
      clockIn: "09:00",
      clockOut: "—",
      warningText: messages.warningLabel.missing_clock_out,
    },
    {
      key: "auto-break",
      date: "2026-08-06",
      clockIn: "09:00",
      clockOut: "19:00",
      worked: 555,
      breakMinutes: 45,
      breakAutoMinutes: 45,
      lateNight: 0,
    },
    {
      key: "leave",
      date: "2026-08-07",
      worked: 0,
      leaveBadge: messages.leave.unitLabelShort.full_day,
    },
  ];
}

function TablePatterns() {
  const rows = buildRows();
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Patterns / Table</h1>
        <p className="story-section__lead">
          月次テーブルの行の型: 通常行・法定休日行(先頭セルがM)・警告行(背景+文言)・
          「自動 0:45」併記(休憩の自動控除)・有給バッジ付き日付セル。
        </p>
      </div>

      <div className="monthly-table-wrap">
        <table className="monthly-table">
          <thead>
            <tr>
              <th>{messages.monthly.columnDate}</th>
              <th className="monthly-table__stretches">{messages.monthly.columnStretches}</th>
              <th className="monthly-table__col-clock-in">{messages.monthly.columnClockIn}</th>
              <th className="monthly-table__col-clock-out">{messages.monthly.columnClockOut}</th>
              <th>{messages.monthly.columnWorked}</th>
              <th>
                {messages.monthly.columnBreak}
                <HelpTip helpKey="attendance.auto-break" />
              </th>
              <th>{messages.monthly.columnLateNight}</th>
              <th>{messages.monthly.columnWarning}</th>
              <th>{messages.monthly.columnActions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const hasStretch = row.clockIn !== undefined;
              const hasActivity = row.worked !== undefined || row.leaveBadge !== undefined;
              return (
                <tr key={row.key} className={row.rowClassName}>
                  <td className="monthly-table__date">
                    {formatDateLabel(row.date)}
                    {row.leaveBadge ? <span className="monthly-table__leave-badge">{row.leaveBadge}</span> : null}
                  </td>
                  <td className="monthly-table__stretches" data-label={messages.monthly.columnStretches}>
                    {hasStretch ? (
                      <div className="monthly-table__stretch tabular-nums">
                        {row.clockIn} → {row.clockOut}
                      </div>
                    ) : null}
                  </td>
                  <td className="monthly-table__col-clock-in" data-label={messages.monthly.columnClockIn}>
                    {hasStretch ? <div className="monthly-table__stretch tabular-nums">{row.clockIn}</div> : null}
                  </td>
                  <td className="monthly-table__col-clock-out" data-label={messages.monthly.columnClockOut}>
                    {hasStretch ? <div className="monthly-table__stretch tabular-nums">{row.clockOut}</div> : null}
                  </td>
                  <td className="monthly-table__num tabular-nums" data-label={messages.monthly.columnWorked}>
                    {hasActivity ? formatDurationHm(row.worked ?? 0) : null}
                  </td>
                  <td className="monthly-table__num" data-label={messages.monthly.columnBreak}>
                    {row.breakMinutes !== undefined ? (
                      <>
                        <div className="tabular-nums">{formatDurationHm(row.breakMinutes)}</div>
                        {row.breakAutoMinutes ? (
                          <div className="monthly-table__break-extra tabular-nums">
                            {messages.monthly.autoBreakLabel} {formatDurationHm(row.breakAutoMinutes)}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  <td className="monthly-table__num" data-label={messages.monthly.columnLateNight}>
                    {row.lateNight !== undefined ? <div className="tabular-nums">{formatDurationHm(row.lateNight)}</div> : null}
                  </td>
                  <td className="monthly-table__warning" data-label={messages.monthly.columnWarning}>
                    {row.warningText ? <span>{row.warningText}</span> : null}
                  </td>
                  <td className="monthly-table__actions" data-label={messages.monthly.columnActions}>
                    <button
                      type="button"
                      className={`monthly-table__correct-btn${row.warningText ? " monthly-table__correct-btn--warn" : ""}`}
                    >
                      {messages.monthly.correctionAction}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const meta = {
  title: "パターン/テーブル",
  component: TablePatterns,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TablePatterns>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RowTypes: Story = { name: "行の型" };
