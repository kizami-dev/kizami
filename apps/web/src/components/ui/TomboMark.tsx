/**
 * 空の状態に添えるトンボ(見当合わせマーク)の線画。
 *
 * ロゴマーク(KizamiMark・apps/web/public/icons/source/kizami-mark.svg)と同じ 64x64 の
 * 座標系・同じ腕の配置(12時=K、3時=C、6時=M、9時=Y)を使い、時計の針だけを持たない
 * 「まだ何も刻まれていない」トンボにする。円は破線にして、空であることを形でも示す。
 * K の部分は currentColor(テーマに追従)、C/M/Y は確定パレットの固定色。
 */
export function TomboMark({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <g strokeWidth="2" fill="none" strokeLinecap="square">
        <line x1="32" y1="4" x2="32" y2="18" stroke="currentColor" />
        <line x1="60" y1="32" x2="46" y2="32" stroke="#00A3D9" />
        <line x1="32" y1="60" x2="32" y2="46" stroke="#E5007E" />
        <line x1="4" y1="32" x2="18" y2="32" stroke="#FFD400" />
        <circle cx="32" cy="32" r="16" stroke="currentColor" strokeDasharray="3 4" strokeLinecap="butt" />
        <line x1="28" y1="32" x2="36" y2="32" stroke="currentColor" />
        <line x1="32" y1="28" x2="32" y2="36" stroke="currentColor" />
      </g>
    </svg>
  );
}
