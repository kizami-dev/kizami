import type { Meta, StoryObj } from "@storybook/react";
import { formatDurationHm } from "../lib/time";
import { messages } from "../lib/messages";

const TOTAL_CATEGORIES = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"] as const;

/**
 * チップ・バッジのカタログ。実クラス(monthly.css の .totals-chip/.closing-badge、
 * org-settings.css の .invite-status-badge、monthly.css の .monthly-table__leave-badge)を
 * 実際のマークアップと同じ形で使う。
 */
function ChipsBadgesCatalog() {
  return (
    <div className="story-section">
      <div>
        <h1 className="story-section__title">Primitives / Chips &amp; Badges</h1>
        <p className="story-section__lead">
          区分別合計チップ(C/M/Y/K)、締めバッジ(確定済み/修正あり)、招待状態バッジ、有給バッジ。
          いずれも「意味色は状態のみ」の枠色ルールに従う。
        </p>
      </div>

      <div className="story-group">
        <p className="story-group__title">区分別合計チップ(MonthlyView の .totals-row)</p>
        <div className="totals-row">
          {TOTAL_CATEGORIES.map((cat) => (
            <span key={cat} className={`totals-chip totals-chip--${cat}`}>
              <span className="totals-chip__label">{messages.totalsCategoryLabel[cat]}</span>
              <span className="totals-chip__value tabular-nums">{formatDurationHm(cat === "statutory" ? 480 : 45)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">締めバッジ(.closing-badge)</p>
        <div className="closing-status">
          <span className="closing-badge closing-badge--closed">{messages.closing.closedBadge}</span>
          <span className="closing-badge closing-badge--amended">{messages.closing.amendedBadge}</span>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">招待状態バッジ(MembersView の .invite-status-badge)</p>
        <div className="story-row">
          <span className="invite-status-badge invite-status-badge--invited">{messages.members.inviteStatusBadge.invited}</span>
          <span className="invite-status-badge invite-status-badge--invite_expired">
            {messages.members.inviteStatusBadge.invite_expired}
          </span>
        </div>
      </div>

      <div className="story-group">
        <p className="story-group__title">有給バッジ(MonthlyView の日付セル、.monthly-table__leave-badge)</p>
        <p className="story-group__note">日付ラベルの直後に付く。時間単位のみ分数を併記する。</p>
        <div className="story-row story-row--center">
          <span>
            8/7(木)
            <span className="monthly-table__leave-badge">{messages.leave.unitLabelShort.full_day}</span>
          </span>
          <span>
            8/8(金)
            <span className="monthly-table__leave-badge">{messages.leave.unitLabelShort.half_day_am}</span>
          </span>
          <span>
            8/9(土)
            <span className="monthly-table__leave-badge">
              {messages.leave.unitLabelShort.hourly} {formatDurationHm(120)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Chips & Badges",
  component: ChipsBadgesCatalog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChipsBadgesCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllChipsAndBadges: Story = {};
