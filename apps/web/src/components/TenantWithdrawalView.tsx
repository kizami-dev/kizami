"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, downloadTenantExport, UnauthorizedError, type TenantWithdrawalDto } from "../lib/api";
import { mapTenantWithdrawalErrorMessage, messages } from "../lib/messages";
import { setTenantWithdrawalNotice } from "../lib/tenantWithdrawal";
import { dateStrFromEpochMinutesJst, formatTimeJst } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingsNav } from "./SettingsNav";
import { buttonClass } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { PageHeader } from "./ui/PageHeader";
import { StateView } from "./ui/StateView";

function formatJst(minutes: number): string {
  return `${dateStrFromEpochMinutesJst(minutes)} ${formatTimeJst(minutes)}`;
}

/**
 * テナントの退会(/settings/withdrawal、2026-10-05、docs/design/tenant-withdrawal.md)。
 *
 * 上から「保存義務の案内 → 全データのエクスポート → 退会の申請(または手続き中の状態と取り消し)」の順に並べる。
 * 判断点: エクスポートを申請より上に置く。労基法109条の保存義務は事業主に残るので、申請の前に
 * 保存してもらうことがこの画面のいちばんの目的であり、申請のボタンだけを先に目にさせない。
 *
 * - 申請の確認ダイアログは影響を列挙したうえで**会社名の再入力**を求める(ConfirmDialog の confirmPhrase、
 *   退職者の個人データの消去と同じ作法)。サーバーも同じ照合をする
 * - 申請・取り消しの結果は lib/tenantWithdrawal.ts のストアにも反映し、ヘッダー直下のバナーをすぐに出す・消す
 * - 全データのエクスポートは通常の状態でも使える(データのポータビリティ)
 */
export function TenantWithdrawalView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [data, setData] = useState<TenantWithdrawalDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<"request" | "cancel" | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    api
      .getTenantWithdrawal()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setLoadError(err instanceof ApiError ? messages.settingsWithdrawal.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await downloadTenantExport();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setExportError(messages.settingsWithdrawal.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  async function handleConfirm() {
    if (!dialog) return;
    setPending(true);
    setActionError(null);
    try {
      const tenantName = guard.tenant?.name ?? "";
      const res = dialog === "request" ? await api.requestTenantWithdrawal(tenantName) : await api.cancelTenantWithdrawal();
      setData(res);
      setTenantWithdrawalNotice(
        res.withdrawal.status === "withdrawing"
          ? { requestedAt: res.withdrawal.requestedAt, scheduledPurgeAt: res.withdrawal.scheduledPurgeAt }
          : null,
      );
      setDone(dialog === "request" ? messages.settingsWithdrawal.requested : messages.settingsWithdrawal.cancelled);
      setDialog(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setActionError(err instanceof ApiError ? mapTenantWithdrawalErrorMessage(err.body) : messages.errors.network);
    } finally {
      setPending(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <StateView kind="loading">{messages.loading}</StateView>;
  }
  if (guard.status === "error" || !guard.user) {
    return <StateView kind="error">{messages.errors.network}</StateView>;
  }

  const m = messages.settingsWithdrawal;
  const withdrawal = data?.withdrawal ?? null;
  const graceDays = data?.graceDays ?? 30;
  const tenantName = guard.tenant?.name ?? "";

  return (
    <div className="page-shell">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="page">
        <SettingsNav active="withdrawal" />
        <PageHeader title={m.title} lead={m.tagline} />

        {forbidden ? (
          <Notice tone="danger" role="alert">
            {m.noPermission}
          </Notice>
        ) : null}
        {loadError ? <StateView kind="error">{loadError}</StateView> : null}
        {done ? (
          <Notice tone="success" role="status">
            {done}
          </Notice>
        ) : null}

        {!forbidden && data && withdrawal ? (
          <div className="page-body page-body--form">
            {withdrawal.status === "withdrawing" ? (
              <section className="card">
                <h2 className="card__title">{m.statusTitle}</h2>
                <dl className="withdrawal-status">
                  <dt>{m.statusRequestedAt}</dt>
                  <dd className="tabular-nums">
                    {formatJst(withdrawal.requestedAt)}
                    {m.japanTime}
                  </dd>
                  <dt>{m.statusPurgeAt}</dt>
                  <dd className="tabular-nums">
                    <strong>
                      {formatJst(withdrawal.scheduledPurgeAt)}
                      {m.japanTime}
                    </strong>
                  </dd>
                </dl>
                <p className="field__hint">{m.statusPurgeNote}</p>
                <p className="field__hint">{data.mailNotifications ? m.mailNotice : m.noMailNotice}</p>
                <div className="btn-row">
                  <button type="button" className={buttonClass("secondary")} onClick={() => setDialog("cancel")}>
                    {m.cancelAction}
                  </button>
                </div>
              </section>
            ) : null}

            <section className="card">
              <h2 className="card__title">{m.legalTitle}</h2>
              <Notice tone="caution">{m.legalBody}</Notice>
            </section>

            <section className="card">
              <h2 className="card__title">{m.exportTitle}</h2>
              <p className="field__hint">{m.exportDesc}</p>
              <p className="field__hint">{m.exportExcluded}</p>
              <p className="field__hint">{m.exportPersonalData}</p>
              {withdrawal.status === "active" ? <p className="field__hint">{m.exportAnytime}</p> : null}
              <div className="btn-row">
                <button type="button" className={buttonClass("primary")} onClick={handleExport} disabled={exporting}>
                  {exporting ? m.exporting : m.exportAction}
                </button>
              </div>
              {exportError ? (
                <Notice tone="danger" role="alert">
                  {exportError}
                </Notice>
              ) : null}
            </section>

            {withdrawal.status === "active" ? (
              <section className="card">
                <h2 className="card__title">{m.requestTitle}</h2>
                <p className="field__hint">{m.requestDesc(graceDays)}</p>
                <p className="field__hint">{m.impactTitle}</p>
                <ul className="withdrawal-impacts">
                  <li>{m.impactLogin}</li>
                  <li>{m.impactPunch}</li>
                  <li>{m.impactNotify}</li>
                  <li>{m.impactReadOnly}</li>
                  <li>{m.impactPurge(graceDays)}</li>
                </ul>
                <p className="field__hint">{data.mailNotifications ? m.mailNotice : m.noMailNotice}</p>
                <div className="btn-row">
                  <button type="button" className={buttonClass("danger-ghost")} onClick={() => setDialog("request")}>
                    {m.requestAction}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>

      {dialog === "request" ? (
        <ConfirmDialog
          title={m.confirmTitle}
          message={
            <>
              <p>{m.confirmMessage(graceDays)}</p>
              <ul>
                <li>{m.impactLogin}</li>
                <li>{m.impactPunch}</li>
                <li>{m.impactNotify}</li>
                <li>{m.impactPurge(graceDays)}</li>
              </ul>
            </>
          }
          extraNote={m.legalBody}
          confirmLabel={m.confirmLabel}
          tone="caution"
          note=""
          pending={pending}
          error={actionError}
          onConfirm={handleConfirm}
          onCancel={() => {
            setDialog(null);
            setActionError(null);
          }}
          confirmPhrase={{ phrase: tenantName, label: m.confirmPhraseLabel, placeholder: tenantName, mismatchHint: m.confirmPhraseMismatch }}
        />
      ) : null}
      {dialog === "cancel" ? (
        <ConfirmDialog
          title={m.cancelConfirmTitle}
          message={m.cancelConfirmMessage}
          confirmLabel={m.cancelConfirmLabel}
          note=""
          pending={pending}
          error={actionError}
          onConfirm={handleConfirm}
          onCancel={() => {
            setDialog(null);
            setActionError(null);
          }}
        />
      ) : null}
    </div>
  );
}
