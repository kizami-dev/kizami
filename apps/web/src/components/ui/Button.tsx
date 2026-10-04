import type { ButtonHTMLAttributes } from "react";

/**
 * 共通ボタン(components.css の .btn)。
 *
 * - primary: 主操作(K 塗り)。1画面(1区画)に1つまで
 * - secondary: 副操作(K の細い枠)
 * - danger: 確定的な危険操作(M 塗り)。確認ダイアログの確定ボタンなど
 * - danger-ghost: 危険操作の入口(M の枠だけ)。押すと確認ダイアログが開く削除・解除など
 * - ghost: 枠なしの補助操作
 *
 * 無効状態は opacity ではなく --k-disabled-* トークンと破線の枠で示す(CSS 側)。
 */
export type ButtonVariant = "primary" | "secondary" | "danger" | "danger-ghost" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", block = false): string {
  return ["btn", `btn--${variant}`, size === "md" ? null : `btn--${size}`, block ? "btn--block" : null]
    .filter(Boolean)
    .join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function Button({ variant = "secondary", size = "md", block = false, className, type = "button", ...rest }: ButtonProps) {
  const cls = className ? `${buttonClass(variant, size, block)} ${className}` : buttonClass(variant, size, block);
  // biome-ignore lint/a11y/useButtonType: type は props で受け取り既定値 "button" を与えている。
  return <button type={type} className={cls} {...rest} />;
}
