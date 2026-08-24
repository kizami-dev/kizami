"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { api, ApiError, UnauthorizedError, type ApprovalFlowSettingsDto, type UpdateApprovalFlowSettingsInput } from "../lib/api";
import { mapApprovalFlowSettingsErrorMessage, messages } from "../lib/messages";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { SettingsNav } from "./SettingsNav";

/** PUT /settings/approval-flow が受け付ける段数。API 側も 1|2 以外は 400 で弾く。 */
type Steps = 1 | 2;

interface FormState {
  correctionSteps: Steps;
  leaveSteps: Steps;
  autoBreakWaiverSteps: Steps;
}

/**
 * API は number を返すため、想定外の値(将来 3 段が増えた等)が来ても画面が壊れないよう
 * 2 以外はすべて単段として扱う(判断点: select の値は 1|2 の2択しか持たないため、
 * 未知の値をそのまま握ると「選択肢に無い値」で表示が空になる)。
 */
function toSteps(value: number): Steps {
  return value === 2 ? 2 : 1;
}

function toFormState(settings: ApprovalFlowSettingsDto): FormState {
  return {
    correctionSteps: toSteps(settings.correctionSteps),
    leaveSteps: toSteps(settings.leaveSteps),
    autoBreakWaiverSteps: toSteps(settings.autoBreakWaiverSteps),
  };
}

/**
 * 多段承認の設定画面(/settings/approval-flow、2026-08-24 追加)。
 * docs/design/approval-flows.md が仕様の正。
 *
 * 構成は SettingsSsoView をそのまま踏襲している(権限が無ければ API の 403 で判定・
 * 保存は監査ログに残る旨を明示)。この画面固有の判断点は2つ:
 * - PUT は3項目すべてが必須(部分更新なし)のため、フォームは常に3項目まとめて送る。
 *   「変えていない項目は送らない」方式にすると invalid_body になる。
 * - 誤解しやすい2点(既に出ている申請の段数は変わらない・二次承認はテナント全体スコープの
 *   承認者が行う)を、select を触る前に読める位置(画面上部)へまとめて出す。
 *   特に「テナント全体スコープの承認者が0人だと申請が滞留する」は運用事故に直結するため、
 *   注意喚起として必ず表示する。
 */
export function SettingsApprovalFlowView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getApprovalFlowSettings()
      .then((res) => {
        if (cancelled) return;
        setForm(toFormState(res));
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
        setLoadError(err instanceof ApiError ? messages.settingsApprovalFlow.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function updateForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaveSuccess(false);

    const body: UpdateApprovalFlowSettingsInput = {
      correctionSteps: form.correctionSteps,
      leaveSteps: form.leaveSteps,
      autoBreakWaiverSteps: form.autoBreakWaiverSteps,
    };

    setSaving(true);
    try {
      const updated = await api.updateApprovalFlowSettings(body);
      setForm(toFormState(updated));
      setSaveSuccess(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapApprovalFlowSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setSaving(false);
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  /** 3つの select は見た目・振る舞いが同じで、ラベルと補足だけが違う。 */
  function renderStepsField(id: string, label: string, hint: string, value: Steps, onChange: (next: Steps) => void) {
    return (
      <div className="correction-field">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value === "2" ? 2 : 1)}>
          <option value={1}>{messages.settingsApprovalFlow.optionOneStep}</option>
          <option value={2}>{messages.settingsApprovalFlow.optionTwoSteps}</option>
        </select>
        <p className="settings-notif__field-hint">{hint}</p>
      </div>
    );
  }

  return (
    <div className="settings-notif">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="settings-notif__main">
        <SettingsNav active="approvalFlow" />
        <h1 className="settings-notif__title">{messages.settingsApprovalFlow.title}</h1>
        <p className="settings-notif__tagline">{messages.settingsApprovalFlow.tagline}</p>
        <p className="settings-notif__field-hint">{messages.settingsApprovalFlow.defaultSingleHint}</p>
        <p className="settings-notif__field-hint">{messages.settingsApprovalFlow.twoStepHint}</p>
        <p className="settings-notif__field-hint">{messages.settingsApprovalFlow.sameApproverHint}</p>
        <p className="settings-notif__field-hint">{messages.settingsApprovalFlow.frozenAtCreationHint}</p>
        <p className="settings-notif__field-hint">{messages.settingsApprovalFlow.tenantApproverRequiredHint}</p>

        {forbidden ? (
          <p className="settings-notif__forbidden" role="alert">
            {messages.settingsApprovalFlow.noPermission}
          </p>
        ) : null}

        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form ? (
          <form className="settings-notif__form" onSubmit={handleSave}>
            <section className="settings-notif__section">
              {renderStepsField(
                "approval-flow-correction",
                messages.settingsApprovalFlow.correctionLabel,
                messages.settingsApprovalFlow.correctionHint,
                form.correctionSteps,
                (correctionSteps) => updateForm({ correctionSteps }),
              )}
              {renderStepsField(
                "approval-flow-leave",
                messages.settingsApprovalFlow.leaveLabel,
                messages.settingsApprovalFlow.leaveHint,
                form.leaveSteps,
                (leaveSteps) => updateForm({ leaveSteps }),
              )}
              {renderStepsField(
                "approval-flow-auto-break-waiver",
                messages.settingsApprovalFlow.autoBreakWaiverLabel,
                messages.settingsApprovalFlow.autoBreakWaiverHint,
                form.autoBreakWaiverSteps,
                (autoBreakWaiverSteps) => updateForm({ autoBreakWaiverSteps }),
              )}
            </section>

            {saveError ? (
              <p className="correction-error" role="alert">
                {saveError}
              </p>
            ) : null}
            {saveSuccess ? <p className="settings-notif__success">{messages.settingsApprovalFlow.saveSuccess}</p> : null}

            <p className="settings-notif__save-note">{messages.settingsApprovalFlow.saveNote}</p>

            <div className="settings-notif__actions">
              <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                {saving ? messages.settingsApprovalFlow.saving : messages.settingsApprovalFlow.save}
              </button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
