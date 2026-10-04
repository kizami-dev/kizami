import type { Meta, StoryObj } from "@storybook/react";
import { formatDurationHm } from "../lib/time";
import { messages } from "../lib/messages";
import { Badge } from "../components/ui/Badge";

const TOTAL_CATEGORIES = ["statutory", "overtime", "overtime60h", "lateNight", "statutoryHoliday"] as const;

/**
 * チップ・バッジのカタログ。実クラス(monthly.css の .totals-chip、components.css の .badge、
 * monthly.css の .monthly-table__leave-badge)を実際のマークアップと同じ形で使う。
 * バッジは太さ(1px の枠・700)を全種類で揃え、色だけで種類を分ける。
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
        <p className="story-group__title">共通バッジ(components.css の .badge)</p>
        <p className="story-group__note">
          neutral=属性・区分、key=状態(標準・申請中)、cyan=確定・承認・有効、magenta=却下・期限切れ・無効化、
          yellow=待ち・注意、scope=機械的な識別子。
        </p>
        <div className="story-row story-row--center">
          <Badge tone="neutral">{messages.monthly.workSystemValue.flex}</Badge>
          <Badge tone="key">{messages.corrections.statusLabel.pending}</Badge>
          <Badge tone="cyan">{messages.closing.closedBadge}</Badge>
          <Badge tone="magenta">{messages.members.inviteStatusBadge.invite_expired}</Badge>
          <Badge tone="yellow">{messages.closing.amendedBadge}</Badge>
          <Badge tone="scope">attendance:read</Badge>
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
