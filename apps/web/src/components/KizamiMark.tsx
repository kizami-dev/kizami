/**
 * KIZAMI ロゴマーク(見当合わせトンボ+時計の針)。
 *
 * 意味: 12時の腕が K(黒)、右回りに C(3時)→M(6時)→Y(9時)。針は1時・5時方向で、
 * これは「K」の字の開き方に由来する。中央円は時計の文字盤かつトンボの円。
 * 確定ソース: apps/web/public/icons/source/kizami-mark.svg
 * (docs/design/ui-direction.md「ロゴとアイコン」節。座標・色・針の角度は変更禁止)。
 *
 * K に相当する部分(12時の腕・円・針)は currentColor を使い、テキスト色に追従させる
 * ことでダーク対応する。CMYK の3色(C/M/Y)は確定パレットの固定色のまま変えない。
 *
 * サイズが小さいほど線を太く・腕をわずかに外へ伸ばす(scripts/generate-icons.mjs と
 * 同じ3段階のバケットをここでも踏襲し、ヘッダーの小さい表示でも潰れないようにする)。
 */
export interface KizamiMarkProps {
  /** 一辺のピクセルサイズ(正方形)。既定 24px(ヘッダー用) */
  size?: number;
  className?: string;
}

function pickBucket(size: number): { strokeWidth: number; tip: number } {
  if (size <= 32) return { strokeWidth: 5, tip: 2 };
  if (size >= 192) return { strokeWidth: 3, tip: 4 };
  return { strokeWidth: 4, tip: 4 };
}

export function KizamiMark({ size = 24, className }: KizamiMarkProps) {
  const { strokeWidth, tip } = pickBucket(size);
  const outer = 64 - tip;

  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="KIZAMI">
      <g strokeWidth={strokeWidth} fill="none" strokeLinecap="square">
        <line x1="32" y1={tip} x2="32" y2="18" stroke="currentColor" />
        <line x1={outer} y1="32" x2="46" y2="32" stroke="#00A3D9" />
        <line x1="32" y1={outer} x2="32" y2="46" stroke="#E5007E" />
        <line x1={tip} y1="32" x2="18" y2="32" stroke="#FFD400" />
        <circle cx="32" cy="32" r="16" stroke="currentColor" />
      </g>
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
        <line x1="32" y1="32" x2="41.5" y2="26.5" />
        <line x1="32" y1="32" x2="41.5" y2="37.5" />
      </g>
    </svg>
  );
}
