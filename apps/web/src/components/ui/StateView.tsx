import type { ReactNode } from "react";
import { TomboMark } from "./TomboMark";

/**
 * 読み込み中・空・エラーの表示(components.css の .state-loading / .state-empty / .state-error)。
 *
 * 各画面が state-loading / state-error を流用していたものを置き換える共通部品。
 * 空の状態だけはトンボの線画を1点添えて、何もないことを静かに楽しく伝える
 * (演出は打刻のスタンプに集中させる方針のため、それ以上の装飾はしない)。
 */
export type StateKind = "loading" | "empty" | "error";

export interface StateViewProps {
  kind: StateKind;
  /** 本文。loading/error では1文、empty では見出しの下の説明。 */
  children?: ReactNode;
  /** empty の見出し(任意)。 */
  title?: ReactNode;
  /** 再試行などの操作(任意)。 */
  action?: ReactNode;
  className?: string;
}

export function StateView({ kind, children, title, action, className }: StateViewProps) {
  const cls = `state-${kind}${className ? ` ${className}` : ""}`;
  if (kind === "empty") {
    return (
      <div className={cls}>
        <TomboMark className="state-empty__mark" />
        {title ? <p className="state-empty__title">{title}</p> : null}
        {children ? <p>{children}</p> : null}
        {action ? <div className="state-error__action">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className={cls} role={kind === "error" ? "alert" : "status"} aria-live={kind === "loading" ? "polite" : undefined}>
      <p>{children}</p>
      {action ? <div className="state-error__action">{action}</div> : null}
    </div>
  );
}
