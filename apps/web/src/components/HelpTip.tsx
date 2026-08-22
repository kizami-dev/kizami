"use client";

import { useEffect, useRef, useState } from "react";
import type { HelpKey } from "../lib/help";
import { helpDocHref, helpEntry } from "../lib/help";

export interface HelpTipProps {
  helpKey: HelpKey;
  /** 見出しの直後などレイアウト側で位置調整したい場合に渡す追加クラス。 */
  className?: string;
}

const ORIGIN_LABEL: Record<string, string> = {
  law: "法令",
  product: "KIZAMIの仕様",
  company: "自社の規定",
};

/** パネルの想定幅(px)。実測前のクランプ計算に使う概算値(CSS の max-width: 22rem と合わせる)。 */
const PANEL_WIDTH_ESTIMATE = 352;
const VIEWPORT_MARGIN = 12;

/**
 * ヘルプの単一表示コンポーネント(docs/design/ui-direction.md「ガイド・ヘルプの方針」)。
 *
 * - 出所バッジを必ず表示する: law は「法令 · 根拠条文」、product は「KIZAMIの仕様」
 *   (法令要件を社内ルールと取り違えない・その逆をしないための§10の最重要原則)
 * - <details>/<summary> ベースの開閉式にする。クリックした人だけが読む静かなヒントとして扱い
 *   (ui-direction.md「演出は打刻画面のみ、それ以外は明瞭優先」)、キーボード・スクリーンリーダーの
 *   標準動作で開閉できる
 * - パネルは `position: fixed` + JS計測で配置する(独自判断点)。CorrectionForm 等のモーダルは
 *   `.k-modal { overflow: hidden }` を持ち、`position: absolute` のままだとモーダルの外に出る
 *   ヘルプパネルが枠内で切れてしまうため、トリガーの座標を実測してビューポート基準で置く
 * - 詳細は VitePress の制度ガイドへリンクする
 */
export function HelpTip({ helpKey, className }: HelpTipProps) {
  const entry = helpEntry(helpKey);
  const badgeLabel = entry.origin === "law" && entry.basis ? `${ORIGIN_LABEL.law} · ${entry.basis}` : (ORIGIN_LABEL[entry.origin] ?? entry.origin);

  const detailsRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - PANEL_WIDTH_ESTIMATE - VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 8, left: Math.max(left, VIEWPORT_MARGIN) });
  }

  useEffect(() => {
    if (!position) return;

    function handlePointerDown(e: PointerEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    function handleReposition() {
      updatePosition();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position !== null]);

  return (
    <details
      ref={detailsRef}
      className={`help-tip${className ? ` ${className}` : ""}`}
      onToggle={(e) => {
        const open = (e.target as HTMLDetailsElement).open;
        setPosition(open ? { top: 0, left: 0 } : null);
        if (open) requestAnimationFrame(updatePosition);
      }}
    >
      <summary ref={triggerRef} className="help-tip__trigger" aria-label={`ヘルプ: ${entry.summary}`}>
        <span className="help-tip__trigger-icon" aria-hidden="true">
          ?
        </span>
      </summary>
      <div
        className="help-tip__panel"
        role="note"
        style={position ? { position: "fixed", top: position.top, left: position.left } : undefined}
      >
        <span className={`help-tip__badge help-tip__badge--${entry.origin}`}>{badgeLabel}</span>
        <p className="help-tip__summary">{entry.summary}</p>
        <a className="help-tip__link" href={helpDocHref(helpKey)} target="_blank" rel="noreferrer">
          詳しく見る →
        </a>
      </div>
    </details>
  );
}
