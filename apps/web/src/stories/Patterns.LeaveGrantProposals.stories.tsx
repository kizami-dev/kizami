import type { Meta, StoryObj } from "@storybook/react";
import type { LeaveGrantProposalDto } from "../lib/api";
import { messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";

/**
 * 「付与の予告」(/settings/leave の LeaveSettingsView、v0.7 フェーズ4)の行の型。
 * Patterns.Table.stories.tsx と同じ方針で、components/LeaveSettingsView.tsx の実マークアップ・
 * 実クラス(.org-table / .leave-proposal-rate / .chip--warning)をそのまま使う
 * (「部品抽出のリファクタはしない」方針)。
 *
 * データ(と messages 参照)は必ず描画関数の中で組み立てる。モジュールスコープの定数にすると
 * import 時点(常に既定ロケール "ja")の文言で固定され、ツールバーのロケール切り替えに
 * 追従しない(Patterns.Table.stories.tsx で踏んだのと同じ罠)。
 */
const ATTENDANCE_RATE_WARNING_THRESHOLD = 0.8;

function formatAttendanceRate(rate: number | null): string {
  return rate === null ? messages.leaveGrantProposals.rateUnknown : `${(rate * 100).toFixed(1)}%`;
}

function buildProposals(): LeaveGrantProposalDto[] {
  const proposedAt = 29_500_000; // 分単位のUTCエポック(架空の固定値)
  return [
    {
      // 通常行: 出勤率が8割以上・シフト基準。
      id: "p-normal",
      userId: "u-1",
      userName: "山田 太郎",
      leaveGrantClass: "full",
      leaveType: "annual",
      grantedOn: "2026-09-15",
      days: 11,
      expiresOn: "2028-09-15",
      attendanceRate: {
        periodFrom: "2025-09-15",
        periodTo: "2026-09-14",
        workingDays: 245,
        attendedDays: 232,
        rate: 232 / 245,
        basis: "shift",
      },
      status: "proposed",
      proposedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: proposedAt,
    },
    {
      // 8割未満の可能性がある行(注意チップつき)。暦日からの推定。
      id: "p-below",
      userId: "u-2",
      userName: "鈴木 愛",
      leaveGrantClass: "full",
      leaveType: "annual",
      grantedOn: "2026-10-01",
      days: 14,
      expiresOn: "2028-10-01",
      attendanceRate: {
        periodFrom: "2025-10-01",
        periodTo: "2026-09-30",
        workingDays: 245,
        attendedDays: 190,
        rate: 190 / 245,
        basis: "calendar_estimate",
      },
      status: "proposed",
      proposedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: proposedAt,
    },
    {
      // 全労働日が0で出勤率を出せない行。0% ではなく「—」を出す(誤判断を避けるため)。
      id: "p-unknown",
      userId: "u-3",
      userName: null,
      leaveGrantClass: "full",
      leaveType: "stocked",
      grantedOn: "2026-11-01",
      days: 3,
      expiresOn: "2029-11-01",
      attendanceRate: {
        periodFrom: "2026-10-25",
        periodTo: "2026-10-31",
        workingDays: 0,
        attendedDays: 0,
        rate: null,
        basis: "calendar_estimate",
      },
      status: "proposed",
      proposedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: proposedAt,
    },
    {
      // 比例付与(週3日)の行。日数がフルタイムの表と違う理由を区分チップで示す。
      id: "p-proportional",
      userId: "u-4",
      userName: "高橋 みどり",
      leaveGrantClass: "days3",
      leaveType: "annual",
      grantedOn: "2026-12-01",
      days: 6,
      expiresOn: "2028-12-01",
      attendanceRate: {
        periodFrom: "2025-12-01",
        periodTo: "2026-11-30",
        workingDays: 150,
        attendedDays: 144,
        rate: 144 / 150,
        basis: "shift",
      },
      status: "proposed",
      proposedAt,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      grantId: null,
      createdAt: proposedAt,
    },
  ];
}

function ProposalTable({ proposals }: { proposals: LeaveGrantProposalDto[] }) {
  if (proposals.length === 0) {
    return <p className="org-settings__empty">{messages.leaveGrantProposals.empty}</p>;
  }
  return (
    <div className="org-settings__table-wrap">
      <table className="org-table">
        <thead>
          <tr>
            <th>{messages.leaveGrantProposals.columnMember}</th>
            <th>{messages.leaveGrantProposals.columnLeaveType}</th>
            <th>{messages.leaveGrantProposals.columnGrantedOn}</th>
            <th>{messages.leaveGrantProposals.columnDays}</th>
            <th>{messages.leaveGrantProposals.columnAttendanceRate}</th>
            <th>{messages.leaveGrantProposals.columnActions}</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => {
            const rate = p.attendanceRate.rate;
            const belowThreshold = rate !== null && rate < ATTENDANCE_RATE_WARNING_THRESHOLD;
            return (
              <tr key={p.id}>
                <td>{p.userName ?? p.userId}</td>
                <td>
                  {p.leaveType === "annual"
                    ? messages.leaveGrantProposals.leaveTypeAnnual
                    : messages.leaveGrantProposals.leaveTypeStocked}
                </td>
                <td className="tabular-nums">{p.grantedOn}</td>
                <td className="tabular-nums">
                  <div className="leave-proposal-days">
                    <span className="tabular-nums">{p.days}</span>
                    {p.leaveGrantClass !== null && p.leaveGrantClass !== "full" ? (
                      <span className="chip">
                        {messages.leaveGrantProposals.proportionalChip(messages.members.leaveGrantClassOption[p.leaveGrantClass])}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="leave-proposal-rate">
                    <span className="tabular-nums">{formatAttendanceRate(rate)}</span>
                    <span className="leave-proposal-rate__basis">
                      {p.attendanceRate.basis === "shift"
                        ? messages.leaveGrantProposals.basisShift
                        : messages.leaveGrantProposals.basisCalendarEstimate}
                    </span>
                    {belowThreshold ? (
                      <span className="chip chip--warning">{messages.leaveGrantProposals.rateBelowThreshold}</span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="org-table__actions">
                    <button type="button" className="org-table__link-btn">
                      {messages.leaveGrantProposals.approve}
                    </button>
                    <button type="button" className="org-table__link-btn org-table__link-btn--danger">
                      {messages.leaveGrantProposals.reject}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LeaveGrantProposalPatterns() {
  const proposals = buildProposals();
  const decidedAt = 29_400_000;
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Patterns / Leave grant proposals</h1>
        <p className="story-section__lead">
          有給付与の「予告」一覧(/settings/leave)。通常行・8割未満の可能性がある行(注意チップ)・
          出勤率が出せない行(「—」)・比例付与の行(区分チップ)・空状態・決裁済みの履歴。
        </p>
      </div>

      <section className="leave-admin-section">
        <h2 className="settings-notif__section-title">{messages.leaveGrantProposals.sectionTitle}</h2>
        <p className="leave-admin-section__desc">{messages.leaveGrantProposals.sectionDesc}</p>
        <ProposalTable proposals={proposals} />

        <details className="leave-grant-details leave-proposal-history" open>
          <summary>{messages.leaveGrantProposals.historyTitle}</summary>
          <div className="leave-grant-table-wrap">
            <table className="leave-grant-table">
              <thead>
                <tr>
                  <th>{messages.leaveGrantProposals.columnStatus}</th>
                  <th>{messages.leaveGrantProposals.columnGrantedOn}</th>
                  <th>{messages.leaveGrantProposals.columnDays}</th>
                  <th>{messages.leaveGrantProposals.columnDecidedAt}</th>
                  <th>{messages.leaveGrantProposals.columnDecisionNote}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{messages.leaveGrantProposals.statusLabel.approved}</td>
                  <td className="tabular-nums">2025-09-15</td>
                  <td className="tabular-nums">10</td>
                  <td className="tabular-nums">{formatDateTimeJst(decidedAt)}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <td>{messages.leaveGrantProposals.statusLabel.rejected}</td>
                  <td className="tabular-nums">2025-10-01</td>
                  <td className="tabular-nums">12</td>
                  <td className="tabular-nums">{formatDateTimeJst(decidedAt + 120)}</td>
                  <td>{messages.leaveGrantProposals.notePlaceholder}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="leave-admin-section">
        <h2 className="settings-notif__section-title">{messages.leaveGrantProposals.sectionTitle}</h2>
        <p className="leave-admin-section__desc">{messages.leaveGrantProposals.sectionDesc}</p>
        <ProposalTable proposals={[]} />
      </section>
    </div>
  );
}

const meta = {
  title: "Patterns/LeaveGrantProposals",
  component: LeaveGrantProposalPatterns,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LeaveGrantProposalPatterns>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RowTypes: Story = {};
