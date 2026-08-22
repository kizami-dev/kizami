/**
 * モバイル下部タブバー用のアイコン(2026-08-22 ナビ作り直しで追加)。
 *
 * KizamiMark.tsx と同じ語彙(線画・幾何学的、円と直線)に揃える。色は付けず currentColor のみ
 * (タブの選択状態は色ではなく太さ・aria-current で示すため、意味色をここで消費しない)。
 * 打刻タブは KizamiMark の「トンボ+時計の針」モチーフをそのまま単色で縮小引用し、
 * 打刻=ブランドの中心という結び付きを保つ(独自判断)。
 */
export interface NavIconProps {
  size?: number;
  className?: string;
}

/** 打刻タブ: KizamiMark のトンボ+針モチーフを単色(currentColor)で。 */
export function PunchTabIcon({ size = 22, className }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="square">
        <line x1="12" y1="1.5" x2="12" y2="6" />
        <line x1="22.5" y1="12" x2="18" y2="12" />
        <line x1="12" y1="22.5" x2="12" y2="18" />
        <line x1="1.5" y1="12" x2="6" y2="12" />
        <circle cx="12" cy="12" r="6" />
      </g>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="12" y1="12" x2="15.2" y2="9.8" />
        <line x1="12" y1="12" x2="15.2" y2="14" />
      </g>
    </svg>
  );
}

/** 月次タブ: カレンダー(綴じ具+区切り線)。 */
export function MonthlyTabIcon({ size = 22, className }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="square" strokeLinejoin="miter">
        <rect x="3.5" y="4.5" width="17" height="16" rx="1" />
        <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
        <line x1="8" y1="2.5" x2="8" y2="6.5" />
        <line x1="16" y1="2.5" x2="16" y2="6.5" />
      </g>
      <g fill="currentColor">
        <circle cx="8" cy="13.5" r="1" />
        <circle cx="12" cy="13.5" r="1" />
        <circle cx="8" cy="17" r="1" />
      </g>
    </svg>
  );
}

/** 申請タブ: 用紙+チェック(修正申請=書類の訂正)。 */
export function CorrectionsTabIcon({ size = 22, className }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M6 3.5h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
        <path d="M14 3.5v4h4" />
        <line x1="8" y1="13" x2="14" y2="13" />
      </g>
      <path d="M7.6 16.8l1.7 1.7 3.4-3.6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** その他タブ: 3本線(ハンバーガー)。KizamiMark の直線の腕と同じ strokeLinecap="square"。 */
export function MoreTabIcon({ size = 22, className }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
        <line x1="4" y1="6.5" x2="20" y2="6.5" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17.5" x2="20" y2="17.5" />
      </g>
    </svg>
  );
}
