"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type TotpSetupDto, type TotpStatusDto } from "../lib/api";
import { mapTwoFactorErrorMessage, messages } from "../lib/messages";
import { formatDateTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";

/** リカバリコードの残数がこれ以下になったら再生成をすすめる(10本中3本 = 心細くなる目安)。 */
const RECOVERY_LOW_THRESHOLD = 3;

/** どのコピーボタンが押されたかを区別するためのキー(コピー結果の表示位置を1箇所に限定する)。 */
type CopyTarget = "secret" | "uri" | "recovery";

/**
 * 二要素認証(TOTP)の設定画面(/settings/security、2026-08-27 追加)。
 *
 * 権限不要(自分の認証設定なので、認証済みなら誰でも自分の 2FA を設定できる。
 * /settings/api-keys と同じ扱い — lib/useSettingsAccess.ts の security 参照)。
 *
 * **v1 では QR コード画像を出さない**(判断点、完了報告に明記):
 * QR を描くには QR エンコーダ(Reed-Solomon 誤り訂正を含む ~300 行)を自作するか、依存を1つ
 * 増やすかのどちらかになる。今回のバッチは「新しい npm 依存を増やさない」制約下にあり、かつ
 * 主要な認証アプリ(Google Authenticator・1Password・Authy・Microsoft Authenticator 等)は
 * いずれも「セットアップキーの手動入力」に対応しているため、base32 の secret と otpauth URI を
 * コピーできる形で出す方式にした。利用者が迷わないよう、その旨は UI 文言
 * (settingsSecurity.setupManualHint)でも明示している。
 *
 * 画面の3状態:
 * - available=false: 運用者が暗号化鍵(KIZAMI_ENCRYPTION_KEY)を設定していない配置。
 *   利用者側では解決できないため、説明だけを出して操作は一切出さない。
 * - enabled=false: 有効化の導線(setup → 6桁コード検証 → リカバリコード1回だけ表示)。
 * - enabled=true: 状態表示 + リカバリコード再生成 / 無効化(どちらもパスワード+現在のコードが必要)。
 */
export function SecuritySettingsView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [status, setStatus] = useState<TotpStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 有効化フロー(setup で仮発行 → enable で確定)。setup の結果はサーバー側にも保持されるが、
  // 画面をリロードすると secret を再表示できないため、パネルを閉じたら setup からやり直す。
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [setupStarting, setSetupStarting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [enabling, setEnabling] = useState(false);

  /** 有効化直後・再生成直後にだけ表示するリカバリコード(以後は二度と取得できない)。 */
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copyState, setCopyState] = useState<{ target: CopyTarget; state: "copied" | "failed" } | null>(null);

  // 無効化・再生成の本人確認(現在のパスワード+現在の6桁コード)。両操作で同じ入力欄を共有する
  // (どちらも「今この場に本人がいること」を示すための同じ確認であり、欄を2組並べると
  // どちらに入力すべきか迷わせるため)。
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabledNotice, setDisabledNotice] = useState(false);

  function load() {
    setLoading(true);
    setLoadError(null);
    return api
      .getTotpStatus()
      .then((res) => setStatus(res))
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsSecurity.loadFailed : messages.errors.network);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (guard.status !== "authed") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  async function handleCopy(target: CopyTarget, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ target, state: "copied" });
    } catch {
      // http:// 配信時やブラウザの権限設定でクリップボードが使えないことがある。
      // 手動選択でコピーできるよう、<code> 側は user-select: all にしてある。
      setCopyState({ target, state: "failed" });
    }
  }

  async function handleStartSetup() {
    setSetupStarting(true);
    setSetupError(null);
    setDisabledNotice(false);
    try {
      const res = await api.startTotpSetup();
      setSetup(res);
      setEnableCode("");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSetupError(err instanceof ApiError ? mapTwoFactorErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSetupStarting(false);
    }
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setSetupError(null);
    if (enableCode.trim() === "") {
      setSetupError(messages.settingsSecurity.errors.invalid_body);
      return;
    }
    setEnabling(true);
    try {
      const res = await api.enableTotp(enableCode.trim());
      // リカバリコードはこのレスポンスでしか取得できない。パネルを出してから状態を読み直す。
      setRecoveryCodes(res.recoveryCodes);
      setCopyState(null);
      setSetup(null);
      setEnableCode("");
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSetupError(err instanceof ApiError ? mapTwoFactorErrorMessage(err.body) : messages.errors.network);
    } finally {
      setEnabling(false);
    }
  }

  async function handleRegenerate(e: React.FormEvent) {
    e.preventDefault();
    setRegenerateError(null);
    setDisabledNotice(false);
    if (verifyPassword === "" || verifyCode.trim() === "") {
      setRegenerateError(messages.settingsSecurity.errors.invalid_body);
      return;
    }
    setRegenerating(true);
    try {
      const res = await api.regenerateTotpRecoveryCodes({ password: verifyPassword, code: verifyCode.trim() });
      setRecoveryCodes(res.recoveryCodes);
      setCopyState(null);
      setVerifyPassword("");
      setVerifyCode("");
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setRegenerateError(err instanceof ApiError ? mapTwoFactorErrorMessage(err.body) : messages.errors.network);
    } finally {
      setRegenerating(false);
    }
  }

  function openDisableConfirm() {
    setDisableError(null);
    setDisabledNotice(false);
    if (verifyPassword === "" || verifyCode.trim() === "") {
      // 確認ダイアログを開く前に足りない入力を指摘する(ダイアログを閉じてから
      // 入力し直す往復を避けるため)。
      setRegenerateError(messages.settingsSecurity.errors.invalid_body);
      return;
    }
    setRegenerateError(null);
    setDisableConfirmOpen(true);
  }

  async function handleDisableConfirm() {
    setDisabling(true);
    setDisableError(null);
    try {
      await api.disableTotp({ password: verifyPassword, code: verifyCode.trim() });
      setDisableConfirmOpen(false);
      setVerifyPassword("");
      setVerifyCode("");
      setRecoveryCodes(null);
      setDisabledNotice(true);
      await load();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setDisableError(err instanceof ApiError ? mapTwoFactorErrorMessage(err.body) : messages.errors.network);
    } finally {
      setDisabling(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="security" />
        <h1 className="settings-notif__title">{messages.settingsSecurity.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsSecurity.tagline}</p>

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {status && !status.available ? (
          /* 暗号化鍵が未設定の配置。利用者側では解決できないため、操作は一切出さない。 */
          <section className="security-settings__unavailable">
            <h2 className="settings-notif__section-title">{messages.settingsSecurity.unavailableTitle}</h2>
            <p className="security-settings__unavailable-desc">{messages.settingsSecurity.unavailableDescription}</p>
          </section>
        ) : null}

        {status?.available ? (
          <>
            {recoveryCodes ? (
              <section className="security-settings__reveal" aria-live="polite">
                <h2 className="settings-notif__section-title">{messages.settingsSecurity.recoveryTitle}</h2>
                <p className="security-settings__reveal-warning">{messages.settingsSecurity.recoveryWarning}</p>
                <p className="settings-notif__field-hint">{messages.settingsSecurity.recoveryDescription}</p>
                <ul className="security-settings__codes">
                  {recoveryCodes.map((code) => (
                    <li key={code}>
                      <code className="security-settings__code">{code}</code>
                    </li>
                  ))}
                </ul>
                <div className="settings-notif__actions">
                  <button
                    type="button"
                    className="k-modal__confirm k-modal__confirm--neutral"
                    onClick={() => void handleCopy("recovery", recoveryCodes.join("\n"))}
                  >
                    {copyState?.target === "recovery" && copyState.state === "copied"
                      ? messages.settingsSecurity.copied
                      : messages.settingsSecurity.recoveryCopyAll}
                  </button>
                  <button type="button" className="k-modal__confirm k-modal__confirm--neutral" onClick={() => setRecoveryCodes(null)}>
                    {messages.settingsSecurity.recoveryDone}
                  </button>
                </div>
                {copyState?.target === "recovery" && copyState.state === "failed" ? (
                  <p className="correction-error" role="alert">
                    {messages.settingsSecurity.copyFailed}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="settings-notif__section">
              <h2 className="settings-notif__section-title">{messages.settingsSecurity.statusTitle}</h2>
              <p className="security-settings__status">
                <span className={`security-settings__badge security-settings__badge--${status.enabled ? "on" : "off"}`}>
                  {status.enabled ? messages.settingsSecurity.statusEnabled : messages.settingsSecurity.statusDisabled}
                </span>
              </p>
              {status.enabled ? (
                <dl className="security-settings__facts">
                  {status.enabledAt !== null ? (
                    <>
                      <dt>{messages.settingsSecurity.enabledAtLabel}</dt>
                      <dd>{formatDateTimeJst(status.enabledAt)}</dd>
                    </>
                  ) : null}
                  <dt>{messages.settingsSecurity.recoveryRemainingLabel}</dt>
                  <dd>{messages.settingsSecurity.recoveryRemainingValue(status.recoveryCodesRemaining)}</dd>
                </dl>
              ) : null}
              {status.enabled && status.recoveryCodesRemaining <= RECOVERY_LOW_THRESHOLD ? (
                <p className="security-settings__warning" role="alert">
                  {messages.settingsSecurity.recoveryRemainingWarning}
                </p>
              ) : null}
              {disabledNotice ? <p className="settings-notif__success">{messages.settingsSecurity.disabledNotice}</p> : null}
            </section>

            {!status.enabled ? (
              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsSecurity.enableTitle}</h2>
                <p className="settings-notif__field-hint">{messages.settingsSecurity.enableDescription}</p>

                {setup ? (
                  <div className="security-settings__setup">
                    <h3 className="security-settings__setup-title">{messages.settingsSecurity.setupTitle}</h3>
                    {/* QR は出さない(このファイル冒頭の判断点参照)。手動入力の手順を明示する。 */}
                    <p className="settings-notif__field-hint">{messages.settingsSecurity.setupManualHint}</p>

                    <div className="correction-field">
                      <label htmlFor="totp-secret">{messages.settingsSecurity.setupSecretLabel}</label>
                      <div className="security-settings__copy-row">
                        <code id="totp-secret" className="security-settings__secret">
                          {setup.secret}
                        </code>
                        <button
                          type="button"
                          className="k-modal__confirm k-modal__confirm--neutral"
                          onClick={() => void handleCopy("secret", setup.secret)}
                        >
                          {copyState?.target === "secret" && copyState.state === "copied"
                            ? messages.settingsSecurity.copied
                            : messages.settingsSecurity.copy}
                        </button>
                      </div>
                      {copyState?.target === "secret" && copyState.state === "failed" ? (
                        <p className="correction-error" role="alert">
                          {messages.settingsSecurity.copyFailed}
                        </p>
                      ) : null}
                    </div>

                    <div className="correction-field">
                      <label htmlFor="totp-uri">{messages.settingsSecurity.setupUriLabel}</label>
                      <div className="security-settings__copy-row">
                        <code id="totp-uri" className="security-settings__uri">
                          {setup.otpauthUri}
                        </code>
                        <button
                          type="button"
                          className="k-modal__confirm k-modal__confirm--neutral"
                          onClick={() => void handleCopy("uri", setup.otpauthUri)}
                        >
                          {copyState?.target === "uri" && copyState.state === "copied"
                            ? messages.settingsSecurity.copied
                            : messages.settingsSecurity.copy}
                        </button>
                      </div>
                      {copyState?.target === "uri" && copyState.state === "failed" ? (
                        <p className="correction-error" role="alert">
                          {messages.settingsSecurity.copyFailed}
                        </p>
                      ) : null}
                    </div>

                    <form className="settings-notif__form" onSubmit={handleEnable}>
                      <div className="correction-field">
                        <label htmlFor="totp-enable-code">{messages.settingsSecurity.setupCodeLabel}</label>
                        <input
                          id="totp-enable-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder={messages.settingsSecurity.setupCodePlaceholder}
                          value={enableCode}
                          onChange={(e) => setEnableCode(e.target.value)}
                        />
                      </div>

                      {setupError ? (
                        <p className="correction-error" role="alert">
                          {setupError}
                        </p>
                      ) : null}

                      <div className="settings-notif__actions">
                        <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={enabling}>
                          {enabling ? messages.settingsSecurity.setupSubmitting : messages.settingsSecurity.setupSubmit}
                        </button>
                        <button
                          type="button"
                          className="k-modal__confirm k-modal__confirm--neutral"
                          disabled={enabling}
                          onClick={() => {
                            setSetup(null);
                            setSetupError(null);
                            setEnableCode("");
                          }}
                        >
                          {messages.settingsSecurity.setupCancel}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <>
                    {setupError ? (
                      <p className="correction-error" role="alert">
                        {setupError}
                      </p>
                    ) : null}
                    <div className="settings-notif__actions">
                      <button
                        type="button"
                        className="k-modal__confirm k-modal__confirm--neutral"
                        disabled={setupStarting}
                        onClick={() => void handleStartSetup()}
                      >
                        {setupStarting ? messages.settingsSecurity.enableStarting : messages.settingsSecurity.enableStart}
                      </button>
                    </div>
                  </>
                )}
              </section>
            ) : (
              <section className="settings-notif__section">
                <h2 className="settings-notif__section-title">{messages.settingsSecurity.verifyTitle}</h2>
                <p className="settings-notif__field-hint">{messages.settingsSecurity.verifyDescription}</p>

                <form className="settings-notif__form" onSubmit={handleRegenerate}>
                  <div className="correction-field">
                    <label htmlFor="totp-verify-password">{messages.settingsSecurity.passwordLabel}</label>
                    <input
                      id="totp-verify-password"
                      type="password"
                      autoComplete="current-password"
                      value={verifyPassword}
                      onChange={(e) => setVerifyPassword(e.target.value)}
                    />
                  </div>

                  <div className="correction-field">
                    <label htmlFor="totp-verify-code">{messages.settingsSecurity.codeLabel}</label>
                    <input
                      id="totp-verify-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder={messages.settingsSecurity.setupCodePlaceholder}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                    />
                  </div>

                  {regenerateError ? (
                    <p className="correction-error" role="alert">
                      {regenerateError}
                    </p>
                  ) : null}

                  {/* 再生成をこのフォームの submit にしてある(=パスワード欄で Enter を押すと
                      再生成が走る)。2つの操作のうち、取り返しがつかない方(無効化)を
                      暗黙の Enter で実行させないための割り当て。 */}
                  <div className="security-settings__action-block">
                    <h3 className="security-settings__setup-title">{messages.settingsSecurity.regenerateTitle}</h3>
                    <p className="settings-notif__field-hint">{messages.settingsSecurity.regenerateDescription}</p>
                    <div className="settings-notif__actions">
                      <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={regenerating || disabling}>
                        {regenerating ? messages.settingsSecurity.regenerateSubmitting : messages.settingsSecurity.regenerateSubmit}
                      </button>
                    </div>
                  </div>

                  <div className="security-settings__action-block">
                    <h3 className="security-settings__setup-title">{messages.settingsSecurity.disableTitle}</h3>
                    <p className="settings-notif__field-hint">{messages.settingsSecurity.disableDescription}</p>
                    <div className="settings-notif__actions">
                      {/* type="button" にして、この中の submit(再生成)と取り違えられないようにする。 */}
                      <button
                        type="button"
                        className="k-modal__confirm k-modal__confirm--caution"
                        disabled={regenerating || disabling}
                        onClick={openDisableConfirm}
                      >
                        {disabling ? messages.settingsSecurity.disableSubmitting : messages.settingsSecurity.disableSubmit}
                      </button>
                    </div>
                  </div>
                </form>
              </section>
            )}
          </>
        ) : null}
      </main>

      {disableConfirmOpen ? (
        <ConfirmDialog
          title={messages.settingsSecurity.disableConfirmTitle}
          message={
            <>
              {messages.settingsSecurity.disableConfirmMessage}
              <ul className="deactivate-confirm__impact">
                <li>{messages.settingsSecurity.disableConfirmImpactPassword}</li>
                <li>{messages.settingsSecurity.disableConfirmImpactRecovery}</li>
                <li>{messages.settingsSecurity.disableConfirmImpactReenable}</li>
              </ul>
            </>
          }
          confirmLabel={messages.settingsSecurity.disableSubmit}
          tone="caution"
          note=""
          pending={disabling}
          error={disableError}
          onConfirm={handleDisableConfirm}
          onCancel={() => {
            setDisableConfirmOpen(false);
            setDisableError(null);
          }}
        />
      ) : null}
    </div>
  );
}
