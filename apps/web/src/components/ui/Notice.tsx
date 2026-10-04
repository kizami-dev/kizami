import type { ReactNode } from "react";

/**
 * 注意書き(components.css の .notice)。左罫線とアイコンで種類を示す。
 *
 * - info: 補足・前提の説明(K/ink-soft)
 * - caution: 気をつけてほしいこと(Y)
 * - danger: エラー・権限なし・取り返しのつかないこと(M)
 * - success: 保存・送信の完了(C)
 *
 * 色だけに意味を持たせないよう、種類ごとにアイコンの形も変えている。
 */
export type NoticeTone = "info" | "caution" | "danger" | "success";

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** エラーは "alert"、完了は "status" を渡すと読み上げられる。 */
  role?: "alert" | "status";
  className?: string;
}

export function Notice({ tone = "info", children, role, className }: NoticeProps) {
  const cls = `notice notice--${tone}${className ? ` ${className}` : ""}`;
  return (
    <div className={cls} role={role}>
      {children}
    </div>
  );
}
