import { useState, type InputHTMLAttributes } from "react";
import { messages } from "../../lib/messages";

/**
 * パスワード入力欄(`.field` の中で input の代わりに使う)。右端の「表示/非表示」で
 * 打ち間違いを目で確かめられるようにする。type は内部で切り替えるため受け取らない。
 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input">
      <input {...props} type={shown ? "text" : "password"} />
      <button type="button" className="password-input__toggle" aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        {shown ? messages.common.hidePassword : messages.common.showPassword}
      </button>
    </div>
  );
}
