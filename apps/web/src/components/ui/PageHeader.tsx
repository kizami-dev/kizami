import type { ReactNode } from "react";

/**
 * ページの見出し部分(components.css の .page-header)。
 *
 * 見出し(h1)・補足・右上の主操作をひとまとめにする。主操作はここ(右上)にだけ置き、
 * 一覧の絞り込み(チェックボックス等)は本文側の .page-toolbar に置く — 画面ごとに
 * 主操作とチェックボックスの並び順がばらばらにならないようにするため。
 *
 * 本文の幅は .page-body(wide、外枠いっぱい)/ .page-body--form(--width-form で左寄せ)。
 */
export interface PageHeaderProps {
  title: ReactNode;
  lead?: ReactNode;
  /** 右上の操作(主操作は1つ。副操作はその左に置く)。 */
  actions?: ReactNode;
  /** 見出しの id(aria-labelledby 用など)。 */
  titleId?: string;
}

export function PageHeader({ title, lead, actions, titleId }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title" id={titleId}>
          {title}
        </h1>
        {lead ? <p className="page-header__lead">{lead}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
