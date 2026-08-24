"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "waku";
import { api, ApiError, MultipleTenantsError, type LoginTenantOption, type SsoAvailableTenant } from "../lib/api";
import { mapLoginErrorMessage, messages } from "../lib/messages";
import { KizamiMark } from "./KizamiMark";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 複数テナント一致時のテナント選択(2026-08-23 追加)。email/password は検証済みのまま
   * 保持し、選択後の再送でパスワード再入力を求めない(Slack のワークスペース選択と同じ体験)。 */
  const [tenantOptions, setTenantOptions] = useState<LoginTenantOption[] | null>(null);
  /**
   * SSO(OIDC)が使えるテナント(2026-08-24 追加)。GET /auth/oidc/available の結果。
   *
   * 照会のタイミングは **メール欄からフォーカスが外れたとき(onBlur)** だけにしてある。
   * 入力のたびにデバウンスで叩く案もあったが、この経路は未認証で開放されており IP ごとに
   * 20回/15分のレート制限が掛かっている(apps/api/src/lib/rate-limit.ts の oidcPerIp)ため、
   * 打鍵に比例して呼ぶと正規利用者が自分で上限に触れる。パスワード欄へ移る操作が
   * 自然に blur を起こすので、実用上これで足りる。
   */
  const [ssoTenants, setSsoTenants] = useState<SsoAvailableTenant[]>([]);
  /** 直近に照会したメールアドレス(同じ値で二重に叩かないため)。 */
  const [ssoLookedUpEmail, setSsoLookedUpEmail] = useState<string | null>(null);
  const [ssoStarting, setSsoStarting] = useState(false);

  // SSO のコールバックが失敗すると /login?error=<code> へ戻ってくる(apps/api/src/routes/auth-oidc.ts)。
  // 初回マウント時に一度だけ読み、messages.login.errors の対応する文言を出す。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(mapLoginErrorMessage({ error: code }));
  }, []);

  // 既にログイン済みならホームへ誘導する(判断点: v0.1 では静かに素通りさせる)
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(() => {
        if (!cancelled) router.replace("/");
      })
      .catch(() => {
        // 未認証・通信エラーはログイン画面に留まる
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** メール欄の blur で「この人が SSO を使える会社」を照会する(失敗しても黙って諦める)。 */
  async function handleEmailBlur() {
    const trimmed = email.trim();
    if (trimmed === "" || !trimmed.includes("@")) {
      setSsoTenants([]);
      setSsoLookedUpEmail(null);
      return;
    }
    if (trimmed === ssoLookedUpEmail) return;
    setSsoLookedUpEmail(trimmed);
    try {
      const res = await api.ssoAvailable(trimmed);
      setSsoTenants(res.tenants.filter((t) => t.ssoEnabled));
    } catch {
      // レート制限・通信エラー等。SSO ボタンが出ないだけで、パスワードログインは通常どおり使える。
      setSsoTenants([]);
    }
  }

  /** SSO 開始。認可 URL を受け取ってそこへ遷移する(状態は httpOnly Cookie 側に入る)。 */
  async function handleSso(tenantId: string) {
    setSsoStarting(true);
    setError(null);
    try {
      const { redirectUrl } = await api.startSso(tenantId);
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(err instanceof ApiError ? mapLoginErrorMessage(err.body) : messages.login.errors.default);
      setSsoStarting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password);
      router.push("/");
    } catch (err) {
      if (err instanceof MultipleTenantsError) {
        setTenantOptions(err.tenants);
      } else if (err instanceof ApiError) {
        // 2026-08-24: HTTP ステータスでの分岐(401 のみ特別扱い)から、サーバーが返す
        // エラーコードでの分岐へ移した。総当たり対策のレート制限(429 rate_limited)を
        // 「ログインに失敗しました」で潰さず、待てば直ると分かる文言で出すため。
        setError(mapLoginErrorMessage(err.body));
      } else {
        setError(messages.login.errors.default);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectTenant(tenantId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email, password, tenantId);
      router.push("/");
    } catch (err) {
      // ここでの失敗は基本的に通信エラーのみ(email/password は直前に検証済み)だが、
      // テナント選択に手間取っている間にレート制限へ掛かることはありうるので、
      // 選択後の再送でも同じマッパーを通す。
      setError(err instanceof ApiError ? mapLoginErrorMessage(err.body) : messages.login.errors.default);
    } finally {
      setSubmitting(false);
    }
  }

  function handleBackToEmail() {
    setTenantOptions(null);
    setError(null);
    // パスワードは再入力させる(選択画面に戻る=別アカウントでの再挑戦の起点のため、
    // 検証済み状態を持ち越さない)。
    setPassword("");
  }

  const selectingTenant = tenantOptions !== null;

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__mark" aria-hidden="true">
            <KizamiMark size={44} />
          </span>
          <span className="login-card__logo">{messages.login.title}</span>
        </div>
        <p className="login-card__tagline">{messages.login.tagline}</p>

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        {selectingTenant ? (
          <div className="login-tenant-select">
            <h2 className="login-tenant-select__title">{messages.login.tenantSelectTitle}</h2>
            <p className="login-tenant-select__desc">{messages.login.tenantSelectDescription}</p>

            <ul className="login-tenant-select__list">
              {tenantOptions.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="login-tenant-select__item"
                    disabled={submitting}
                    onClick={() => handleSelectTenant(t.id)}
                  >
                    {t.name ?? messages.login.tenantUnnamed}
                  </button>
                  {/* その会社が SSO を有効にしていれば、パスワードでの続行と並べて SSO も選べる */}
                  {ssoTenants.some((s) => s.id === t.id) ? (
                    <button
                      type="button"
                      className="login-sso__button login-sso__button--inline"
                      disabled={ssoStarting || submitting}
                      onClick={() => void handleSso(t.id)}
                    >
                      {ssoStarting ? messages.login.ssoStarting : messages.login.ssoButton}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>

            <button type="button" className="login-tenant-select__back" onClick={handleBackToEmail} disabled={submitting}>
              {messages.login.backToEmail}
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label htmlFor="login-email">{messages.login.emailLabel}</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => void handleEmailBlur()}
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password">{messages.login.passwordLabel}</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? messages.login.submitting : messages.login.submit}
            </button>

            {ssoTenants.length > 0 ? (
              <div className="login-sso">
                <p className="login-sso__divider">{messages.login.ssoDivider}</p>
                {ssoTenants.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="login-sso__button"
                    disabled={ssoStarting || submitting}
                    onClick={() => void handleSso(t.id)}
                  >
                    {ssoStarting
                      ? messages.login.ssoStarting
                      : ssoTenants.length === 1
                        ? messages.login.ssoButton
                        : messages.login.ssoButtonForTenant(t.name ?? messages.login.tenantUnnamed)}
                  </button>
                ))}
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
