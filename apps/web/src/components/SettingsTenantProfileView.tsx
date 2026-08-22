"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import { listUpcomingChanges, resolveLawRules, type LawRules, type LawVersion } from "@kizami/law";
import { api, ApiError, UnauthorizedError, type TenantLawProfileDto } from "../lib/api";
import { mapTenantProfileErrorMessage, messages } from "../lib/messages";
import { dateStrFromEpochMinutesJst, nowMinutes } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { ConfirmDialog } from "./ConfirmDialog";
import { HelpTip } from "./HelpTip";
import { SettingsNav } from "./SettingsNav";

/** LawRules のトップレベルキーのうち、法改正で変わりうるものの表示順(packages/law/src/types.ts の定義順)。 */
const RULE_KEY_ORDER = ["weeklyStatutoryMinutes", "lateNight", "overtime60h", "agreement36", "annualLeave"] as const;

/** ある LawVersion が前の版から何を変えたか(変更されたトップレベルキーのラベル一覧)を返す。 */
function changedRuleLabels(version: LawVersion): string[] {
  const changedKeys = new Set(Object.keys(version.rules));
  return RULE_KEY_ORDER.filter((key) => changedKeys.has(key)).map((key) => messages.settingsTenantProfile.upcomingRuleLabel[key]);
}

/** 分 → "N時間"(週法定労働時間・36協定の各閾値は端数の出ない値のみを扱う契約なので単純な除算でよい)。 */
function formatHours(minutes: number): string {
  return `${minutes / 60}時間`;
}

/**
 * テナントプロファイル設定(/settings/tenant-profile、v0.3)。要件:
 * - 中小企業・特例措置対象事業場・特別条項締結の3値(いずれも集計に直接影響する)を設定する
 * - 保存前に ConfirmDialog で影響を明示する(§10 コンテキストヘルプ・依頼どおり)
 * - 現在適用中の主要な値(週法定労働時間・36協定上限・時間単位年休上限)と、適用予定の法改正
 *   (@kizami/law の listUpcomingChanges)を併記する
 *
 * 判断点(独自判断): 「現在適用中の値」は保存済み(サーバー側の実際の設定)である profile から
 * 計算する。フォーム編集中の未保存値(form)からリアルタイムプレビューする案も検討したが、
 * 「保存されていない変更が集計に反映されているように見える」誤解を避けるため、実際に効いている
 * 値のみを表示する方針にした(依頼の「保存前に確認ダイアログ」という慎重さの方針とも整合する)。
 */
export function SettingsTenantProfileView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [profile, setProfile] = useState<TenantLawProfileDto | null>(null);
  const [form, setForm] = useState<TenantLawProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    api
      .getTenantProfile()
      .then((res) => {
        if (cancelled) return;
        setProfile(res);
        setForm(res);
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
        setLoadError(err instanceof ApiError ? messages.settingsTenantProfile.loadFailed : messages.errors.network);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  function updateForm(patch: Partial<TenantLawProfileDto>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleConfirm() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateTenantProfile(form);
      setProfile(updated);
      setForm(updated);
      setSaveSuccess(true);
      setConfirmOpen(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setSaveError(err instanceof ApiError ? mapTenantProfileErrorMessage(err.body) : messages.errors.network);
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

  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());
  const currentRules: LawRules | null = profile
    ? resolveLawRules(todayDate, {
        isSmallOrMediumEnterprise: profile.isSmallOrMediumEnterprise,
        isSpecialProvisionWorkplace: profile.isSpecialProvisionWorkplace,
      })
    : null;
  const upcoming: LawVersion[] = profile
    ? listUpcomingChanges(todayDate, {
        isSmallOrMediumEnterprise: profile.isSmallOrMediumEnterprise,
        isSpecialProvisionWorkplace: profile.isSpecialProvisionWorkplace,
      })
    : [];

  return (
    <div className="tenant-profile">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="settings" />
      <main className="tenant-profile__main">
        <SettingsNav active="tenantProfile" />
        <h1 className="tenant-profile__title">{messages.settingsTenantProfile.title}</h1>
        <p className="tenant-profile__tagline">{messages.settingsTenantProfile.tagline}</p>

        {forbidden ? (
          <p className="tenant-profile__forbidden" role="alert">
            {messages.settingsTenantProfile.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && form ? (
          <>
            <form
              className="tenant-profile__form"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <div className="tenant-profile__field">
                <label className="tenant-profile__checkbox">
                  <input
                    type="checkbox"
                    checked={form.isSmallOrMediumEnterprise}
                    onChange={(e) => updateForm({ isSmallOrMediumEnterprise: e.target.checked })}
                  />
                  {messages.settingsTenantProfile.smeLabel}
                  <HelpTip helpKey="overtime.60h" />
                </label>
                <p className="tenant-profile__hint">{messages.settingsTenantProfile.smeHint}</p>
              </div>

              <div className="tenant-profile__field">
                <label className="tenant-profile__checkbox">
                  <input
                    type="checkbox"
                    checked={form.isSpecialProvisionWorkplace}
                    onChange={(e) => updateForm({ isSpecialProvisionWorkplace: e.target.checked })}
                  />
                  {messages.settingsTenantProfile.specialProvisionLabel}
                </label>
                <p className="tenant-profile__hint">{messages.settingsTenantProfile.specialProvisionHint}</p>
              </div>

              <div className="tenant-profile__field">
                <label className="tenant-profile__checkbox">
                  <input
                    type="checkbox"
                    checked={form.specialClauseEnabled}
                    onChange={(e) => updateForm({ specialClauseEnabled: e.target.checked })}
                  />
                  {messages.settingsTenantProfile.specialClauseLabel}
                  <HelpTip helpKey="agreement36.limits" />
                </label>
                <p className="tenant-profile__hint">{messages.settingsTenantProfile.specialClauseHint}</p>
              </div>

              {saveError ? (
                <p className="correction-error" role="alert">
                  {saveError}
                </p>
              ) : null}
              {saveSuccess ? <p className="tenant-profile__success">{messages.settingsTenantProfile.saveSuccess}</p> : null}

              <div className="tenant-profile__actions">
                <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={saving}>
                  {saving ? messages.settingsTenantProfile.saving : messages.settingsTenantProfile.save}
                </button>
              </div>
            </form>

            {currentRules ? (
              <section className="law-rules">
                <h2 className="law-rules__title">{messages.settingsTenantProfile.currentRulesTitle}</h2>
                <div className="law-rules__grid">
                  <div className="law-rules__item">
                    <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesWeekly}</span>
                    <span className="law-rules__item-value tabular-nums">
                      {formatHours(currentRules.weeklyStatutoryMinutes)}
                    </span>
                  </div>
                  <div className="law-rules__item">
                    <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesAgreementMonthly}</span>
                    <span className="law-rules__item-value tabular-nums">
                      {formatHours(currentRules.agreement36.monthlyLimitMinutes)}
                    </span>
                  </div>
                  <div className="law-rules__item">
                    <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesAgreementAnnual}</span>
                    <span className="law-rules__item-value tabular-nums">
                      {formatHours(currentRules.agreement36.annualLimitMinutes)}
                    </span>
                  </div>
                  <div className="law-rules__item">
                    <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesHourlyLeave}</span>
                    <span className="law-rules__item-value tabular-nums">
                      {currentRules.annualLeave.hourlyMaxDays}
                      {messages.settingsTenantProfile.currentRulesHourlyLeaveUnit}
                    </span>
                  </div>
                </div>

                {form.specialClauseEnabled && Number.isFinite(currentRules.agreement36.specialMonthlyCapMinutes) ? (
                  <div className="law-rules__special">
                    <span className="law-rules__special-title">
                      {messages.settingsTenantProfile.currentRulesSpecialClauseTitle}
                    </span>
                    <div className="law-rules__grid">
                      <div className="law-rules__item">
                        <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesSpecialMonthlyCap}</span>
                        <span className="law-rules__item-value tabular-nums">
                          {formatHours(currentRules.agreement36.specialMonthlyCapMinutes)}
                          {messages.settingsTenantProfile.currentRulesSpecialMonthlyCapNote}
                        </span>
                      </div>
                      <div className="law-rules__item">
                        <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesSpecialMultiMonth}</span>
                        <span className="law-rules__item-value tabular-nums">
                          {formatHours(currentRules.agreement36.specialMultiMonthAverageMinutes)}
                        </span>
                      </div>
                      <div className="law-rules__item">
                        <span className="law-rules__item-label">{messages.settingsTenantProfile.currentRulesSpecialAnnual}</span>
                        <span className="law-rules__item-value tabular-nums">
                          {formatHours(currentRules.agreement36.specialAnnualLimitMinutes)}
                        </span>
                      </div>
                      <div className="law-rules__item">
                        <span className="law-rules__item-label">
                          {messages.settingsTenantProfile.currentRulesSpecialExceedCount}
                        </span>
                        <span className="law-rules__item-value tabular-nums">
                          {currentRules.agreement36.specialMonthlyExceedCountLimit}
                          {messages.settingsTenantProfile.currentRulesSpecialExceedCountUnit}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="upcoming-laws">
              <h2 className="upcoming-laws__title">
                {messages.settingsTenantProfile.upcomingTitle}
                <HelpTip helpKey="law.versioning" />
              </h2>
              {upcoming.length === 0 ? (
                <p className="upcoming-laws__empty">{messages.settingsTenantProfile.upcomingEmpty}</p>
              ) : (
                <ul className="upcoming-laws__list">
                  {upcoming.map((version, i) => (
                    <li key={`${version.effectiveFrom}-${i}`} className="upcoming-laws__item">
                      <span className="upcoming-laws__effective-from tabular-nums">
                        {messages.settingsTenantProfile.upcomingEffectiveFrom}: {version.effectiveFrom}
                      </span>
                      <span className="upcoming-laws__changes">
                        {messages.settingsTenantProfile.upcomingChangesPrefix}
                        {changedRuleLabels(version).join("、")}
                      </span>
                      <span className="upcoming-laws__basis">
                        {messages.settingsTenantProfile.upcomingBasis}: {version.basis}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>

      {confirmOpen && form ? (
        <ConfirmDialog
          title={messages.settingsTenantProfile.confirmTitle}
          message={messages.settingsTenantProfile.confirmMessage}
          extraNote={messages.settingsTenantProfile.confirmExtraNote}
          confirmLabel={messages.settingsTenantProfile.confirmLabel}
          tone="caution"
          note=""
          pending={saving}
          error={saveError}
          onConfirm={handleConfirm}
          onCancel={() => {
            setConfirmOpen(false);
            setSaveError(null);
          }}
        />
      ) : null}
    </div>
  );
}
