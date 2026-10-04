import type { ReactNode } from "react";

/**
 * 入力欄のまとまり(components.css の .field)。ラベル・入力部品・補足・エラーを縦に積む。
 *
 * 入力部品(input / select / textarea)は children としてそのまま渡す(id は呼び出し側が
 * 付け、htmlFor に同じ値を渡す)。高さ 44px・ダークでの select の見た目は CSS 側で揃う。
 */
export interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  const cls = ["field", error ? "field--invalid" : null, className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="field__hint">{hint}</p> : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
