import type { ReactNode } from "react";

/**
 * バッジ(components.css の .badge)。太さ(1px の枠・700)は全種類で同じ。
 *
 * - neutral: 属性・区分(ink-soft)
 * - key: 状態(K)。標準・申請中など
 * - cyan: 確定・承認・有効
 * - magenta: 却下・期限切れ・無効化・危険
 * - yellow: 待ち・注意
 * - scope: 機械的な識別子(API キーのスコープなど、等幅)
 */
export type BadgeTone = "neutral" | "key" | "cyan" | "magenta" | "yellow" | "scope";

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`badge badge--${tone}${className ? ` ${className}` : ""}`}>{children}</span>;
}

/** 申請(打刻修正・休暇・休憩の打ち消し)の状態 → バッジの色。 */
export type RequestStatus = "pending" | "approved_step1" | "approved" | "rejected" | "withdrawn";

const REQUEST_STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  pending: "key",
  approved_step1: "yellow",
  approved: "cyan",
  rejected: "magenta",
  withdrawn: "neutral",
};

export function requestStatusTone(status: RequestStatus): BadgeTone {
  return REQUEST_STATUS_TONE[status];
}
