"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AllowanceConditionsDto,
  type AllowanceDefinitionDto,
  type AllowanceDefinitionVersionDto,
} from "../lib/api";
import { summarizeAllowanceConditions } from "../lib/allowances";
import { mapAllowanceSettingsErrorMessage, messages } from "../lib/messages";
import { currentYearMonthJst, dateStrFromEpochMinutesJst, formatMonthParam, nowMinutes, shiftMonth } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { AppHeader } from "./AppHeader";
import { HelpTip } from "./HelpTip";
import { SettingsNav } from "./SettingsNav";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** 分(0〜1439) → "HH:MM"。SettingsAttendanceView と同じ形式(既存方針どおりファイルごとに小さく再実装)。 */
function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? `0${h}` : h}:${m < 10 ? `0${m}` : m}`;
}

/** "HH:MM" → 分(0〜1439)。不正な形式は null。 */
function hmToMinutes(hm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function defaultNextMonthFirstDay(): string {
  const next = shiftMonth(currentYearMonthJst(), 1);
  return `${formatMonthParam(next)}-01`;
}

/** 特定日1行の編集用フォーム状態。value は常に "YYYY-MM-DD"(<input type="date"> の形式)。yearly=true のとき年は無視して "--MM-DD" として送る。 */
interface AllowanceDateRowForm {
  value: string;
  yearly: boolean;
}

/**
 * 手当定義の条件エディタの編集用フォーム状態。3つの条件(特定日・曜日・時間帯)はすべて任意で、
 * 少なくとも1つを指定する(依頼どおり、API の conditions_required に対応するクライアント側検証も行う)。
 */
interface AllowanceConditionsFormState {
  dateRows: AllowanceDateRowForm[];
  /** 添字0〜6が日曜〜土曜(WEEKDAYS と同じ順)。 */
  weekdays: boolean[];
  timeBandEnabled: boolean;
  startHm: string;
  endHm: string;
}

function emptyConditionsForm(): AllowanceConditionsFormState {
  return {
    dateRows: [],
    weekdays: [false, false, false, false, false, false, false],
    timeBandEnabled: false,
    startHm: "00:00",
    endHm: "00:00",
  };
}

/** 既存の条件(API から取得した AllowanceConditionsDto)をフォーム状態へ変換する(版追加フォームのプレフィル用)。 */
function conditionsFormFromDto(conditions: AllowanceConditionsDto): AllowanceConditionsFormState {
  const currentYear = new Date().getFullYear();
  const weekdays = [false, false, false, false, false, false, false];
  for (const w of conditions.weekdays ?? []) weekdays[w] = true;
  return {
    dateRows: (conditions.dates ?? []).map((d) =>
      d.startsWith("--") ? { value: `${currentYear}-${d.slice(2)}`, yearly: true } : { value: d, yearly: false },
    ),
    weekdays,
    timeBandEnabled: !!conditions.timeBand,
    startHm: conditions.timeBand ? minutesToHm(conditions.timeBand.startMinutes) : "00:00",
    endHm: conditions.timeBand ? minutesToHm(conditions.timeBand.endMinutes) : "00:00",
  };
}

interface AllowanceFormState {
  effectiveFrom: string;
  name: string;
  conditions: AllowanceConditionsFormState;
}

function initialCreateForm(): AllowanceFormState {
  return { effectiveFrom: defaultNextMonthFirstDay(), name: "", conditions: emptyConditionsForm() };
}

/** 既存定義の「現在有効な版」(未来日のみなら最新の版)をプレフィルの元にする。 */
function baseVersionFor(def: AllowanceDefinitionDto): AllowanceDefinitionVersionDto | null {
  return def.effective ?? def.history[def.history.length - 1] ?? null;
}

function initialVersionForm(def: AllowanceDefinitionDto): AllowanceFormState {
  const base = baseVersionFor(def);
  return {
    effectiveFrom: defaultNextMonthFirstDay(),
    name: base?.name ?? "",
    conditions: base ? conditionsFormFromDto(base.conditions) : emptyConditionsForm(),
  };
}

type BuildConditionsResult = { ok: true; conditions: AllowanceConditionsDto } | { ok: false; error: string };

/**
 * フォームの条件エディタ状態 → API 入力の AllowanceConditionsDto。
 * サーバー側(routes/settings.ts isValidAllowanceConditions・isEmptyAllowanceConditions)と
 * 同じ制約をクライアント側でも先取りして検証する: 特定日の行はすべて値必須、時間帯を指定する場合は
 * 開始・終了が異なること、そして全条件省略は禁止(conditions_required)。
 */
function buildAllowanceConditionsInput(form: AllowanceConditionsFormState): BuildConditionsResult {
  const dates: string[] = [];
  for (const row of form.dateRows) {
    if (row.value.length === 0) return { ok: false, error: "invalid_conditions" };
    dates.push(row.yearly ? `--${row.value.slice(5)}` : row.value);
  }

  const weekdays = WEEKDAYS.filter((w) => form.weekdays[w]);

  let timeBand: { startMinutes: number; endMinutes: number } | undefined;
  if (form.timeBandEnabled) {
    const startMinutes = hmToMinutes(form.startHm);
    const endMinutes = hmToMinutes(form.endHm);
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
      return { ok: false, error: "invalid_conditions" };
    }
    timeBand = { startMinutes, endMinutes };
  }

  if (dates.length === 0 && weekdays.length === 0 && !timeBand) {
    return { ok: false, error: "conditions_required" };
  }

  return {
    ok: true,
    conditions: {
      ...(dates.length > 0 ? { dates } : {}),
      ...(weekdays.length > 0 ? { weekdays } : {}),
      ...(timeBand ? { timeBand } : {}),
    },
  };
}

/**
 * 条件エディタ(特定日・曜日・時間帯)。手当定義の新規作成フォーム・版追加フォームの両方から
 * 使う共通部品(定義の数だけフォームが並ぶため、必ず value/onChange の制御コンポーネントにする)。
 */
function AllowanceConditionsEditor({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: AllowanceConditionsFormState;
  onChange: (next: AllowanceConditionsFormState) => void;
}) {
  function updateDateRow(i: number, patch: Partial<AllowanceDateRowForm>) {
    onChange({ ...value, dateRows: value.dateRows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) });
  }
  function addDateRow() {
    const today = dateStrFromEpochMinutesJst(nowMinutes());
    onChange({ ...value, dateRows: [...value.dateRows, { value: today, yearly: false }] });
  }
  function removeDateRow(i: number) {
    onChange({ ...value, dateRows: value.dateRows.filter((_, idx) => idx !== i) });
  }
  function toggleWeekday(w: number) {
    onChange({ ...value, weekdays: value.weekdays.map((checked, idx) => (idx === w ? !checked : checked)) });
  }

  return (
    <div className="allowance-settings__conditions">
      <p className="attendance-settings__field-hint">{messages.settingsAllowances.conditionsSectionHint}</p>

      <fieldset className="attendance-settings__field">
        <legend>{messages.settingsAllowances.datesFieldLabel}</legend>
        <p className="attendance-settings__field-hint">{messages.settingsAllowances.datesFieldHint}</p>
        {value.dateRows.map((row, i) => (
          <div className="allowance-settings__date-row" key={`${idPrefix}-date-${i}`}>
            <input
              type="date"
              aria-label={messages.settingsAllowances.dateRowAriaLabel}
              value={row.value}
              onChange={(e) => updateDateRow(i, { value: e.target.value })}
            />
            <label className="attendance-settings__radio">
              <input type="checkbox" checked={row.yearly} onChange={(e) => updateDateRow(i, { yearly: e.target.checked })} />
              {messages.settingsAllowances.dateYearlyCheckbox}
            </label>
            <button type="button" className="attendance-settings__break-rule-remove" onClick={() => removeDateRow(i)}>
              {messages.settingsAllowances.removeDateRow}
            </button>
          </div>
        ))}
        <button type="button" className="k-modal__cancel" onClick={addDateRow}>
          {messages.settingsAllowances.addDateRow}
        </button>
      </fieldset>

      <fieldset className="attendance-settings__field">
        <legend>{messages.settingsAllowances.weekdaysFieldLabel}</legend>
        <p className="attendance-settings__field-hint">{messages.settingsAllowances.weekdaysFieldHint}</p>
        <div className="allowance-settings__weekdays">
          {WEEKDAYS.map((w) => (
            <label key={w} className="attendance-settings__checkbox allowance-settings__weekday">
              <input type="checkbox" checked={value.weekdays[w]} onChange={() => toggleWeekday(w)} />
              {messages.settingsAttendance.weekdayLabel[w]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="attendance-settings__field">
        <legend>{messages.settingsAllowances.timeBandFieldLabel}</legend>
        <label className="attendance-settings__checkbox">
          <input
            type="checkbox"
            checked={value.timeBandEnabled}
            onChange={(e) => onChange({ ...value, timeBandEnabled: e.target.checked })}
          />
          {messages.settingsAllowances.timeBandEnabledCheckbox}
        </label>
        {value.timeBandEnabled ? (
          <div className="allowance-settings__time-band">
            <label className="attendance-settings__field">
              <span>{messages.settingsAllowances.timeBandStartLabel}</span>
              <input type="time" value={value.startHm} onChange={(e) => onChange({ ...value, startHm: e.target.value })} />
            </label>
            <label className="attendance-settings__field">
              <span>{messages.settingsAllowances.timeBandEndLabel}</span>
              <input type="time" value={value.endHm} onChange={(e) => onChange({ ...value, endHm: e.target.value })} />
            </label>
            <span className="attendance-settings__field-hint">{messages.settingsAllowances.timeBandHint}</span>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

/**
 * 手当対象時間の設定画面(/settings/allowances、docs/design/allowances.md、2026-08-23 追加)。
 *
 * SettingsAttendanceView を手本にした effective-dated の版管理 UI だが、work_policy と違い
 * 「テナントにつき何件でも並行して存在しうる」定義のため、①新しい定義の作成フォーム
 * ②既存定義ごとの現在値・版追加フォーム・履歴、の2段構成にする。版追加フォームは定義の数だけ
 * 独立して存在するため、フォーム状態は definitionId をキーにした Record で持つ。
 */
export function SettingsAllowancesView() {
  const router = useRouter();
  const guard = useAuthGuard();

  const [data, setData] = useState<{ definitions: AllowanceDefinitionDto[] } | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [createForm, setCreateForm] = useState<AllowanceFormState>(initialCreateForm());
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);

  const [versionForms, setVersionForms] = useState<Record<string, AllowanceFormState>>({});
  const [versionSaving, setVersionSaving] = useState<Record<string, boolean>>({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string | null>>({});
  const [versionSuccess, setVersionSuccess] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);

    api
      .getAllowances()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setVersionForms(Object.fromEntries(res.definitions.map((def) => [def.id, initialVersionForm(def)])));
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
        setLoadError(messages.settingsAllowances.loadFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status, reloadKey]);

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (createForm.name.trim().length === 0) {
      setCreateError(mapAllowanceSettingsErrorMessage({ error: "invalid_name" }));
      return;
    }
    const built = buildAllowanceConditionsInput(createForm.conditions);
    if (!built.ok) {
      setCreateError(mapAllowanceSettingsErrorMessage({ error: built.error }));
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    setCreateSuccess(false);
    try {
      await api.createAllowanceDefinition({ effectiveFrom: createForm.effectiveFrom, name: createForm.name, conditions: built.conditions });
      setCreateSuccess(true);
      setCreateForm(initialCreateForm());
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCreateError(err instanceof ApiError ? mapAllowanceSettingsErrorMessage(err.body) : messages.errors.network);
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleVersionSubmit(definitionId: string, e: React.FormEvent) {
    e.preventDefault();
    const form = versionForms[definitionId];
    if (!form) return;

    if (form.name.trim().length === 0) {
      setVersionErrors((prev) => ({ ...prev, [definitionId]: mapAllowanceSettingsErrorMessage({ error: "invalid_name" }) }));
      return;
    }
    const built = buildAllowanceConditionsInput(form.conditions);
    if (!built.ok) {
      setVersionErrors((prev) => ({ ...prev, [definitionId]: mapAllowanceSettingsErrorMessage({ error: built.error }) }));
      return;
    }

    setVersionSaving((prev) => ({ ...prev, [definitionId]: true }));
    setVersionErrors((prev) => ({ ...prev, [definitionId]: null }));
    setVersionSuccess((prev) => ({ ...prev, [definitionId]: false }));
    try {
      await api.createAllowanceDefinitionVersion(definitionId, {
        effectiveFrom: form.effectiveFrom,
        name: form.name,
        conditions: built.conditions,
      });
      setVersionSuccess((prev) => ({ ...prev, [definitionId]: true }));
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setVersionErrors((prev) => ({
        ...prev,
        [definitionId]: err instanceof ApiError ? mapAllowanceSettingsErrorMessage(err.body) : messages.errors.network,
      }));
    } finally {
      setVersionSaving((prev) => ({ ...prev, [definitionId]: false }));
    }
  }

  if (guard.status === "loading" || loading) {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const todayDate = dateStrFromEpochMinutesJst(nowMinutes());

  return (
    <div className="attendance-settings">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} tenantName={guard.tenant?.name ?? null} active="settings" />
      <main className="attendance-settings__main">
        <SettingsNav active="allowances" />
        <h1 className="attendance-settings__title">{messages.settingsAllowances.title}</h1>
        <p className="attendance-settings__tagline">{messages.settingsAllowances.tagline}</p>

        {forbidden ? (
          <p className="attendance-settings__forbidden" role="alert">
            {messages.settingsAllowances.noPermission}
          </p>
        ) : null}
        {loadError ? <p className="monthly-error">{loadError}</p> : null}

        {!forbidden && data ? (
          <>
            <section className="attendance-settings__section">
              <h2 className="attendance-settings__section-title">
                {messages.settingsAllowances.createDefinitionTitle}
                <HelpTip helpKey="law.versioning" />
              </h2>
              <form className="attendance-settings__form" onSubmit={handleCreateSubmit}>
                <p className="attendance-settings__effective-hint">{messages.settingsAllowances.effectiveFromHint}</p>

                <label className="attendance-settings__field">
                  <span>{messages.settingsAllowances.nameLabel}</span>
                  <input
                    type="text"
                    placeholder={messages.settingsAllowances.namePlaceholder}
                    value={createForm.name}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </label>

                <label className="attendance-settings__field">
                  <span>{messages.settingsAllowances.effectiveFromLabel}</span>
                  <input
                    type="date"
                    min={todayDate}
                    value={createForm.effectiveFrom}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                    required
                  />
                </label>

                <AllowanceConditionsEditor
                  idPrefix="create"
                  value={createForm.conditions}
                  onChange={(conditions) => setCreateForm((prev) => ({ ...prev, conditions }))}
                />

                {createError ? (
                  <p className="correction-error" role="alert">
                    {createError}
                  </p>
                ) : null}
                {createSuccess ? <p className="attendance-settings__success">{messages.settingsAllowances.createSuccess}</p> : null}

                <div className="attendance-settings__actions">
                  <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={createSaving}>
                    {createSaving ? messages.settingsAllowances.creating : messages.settingsAllowances.createDefinitionButton}
                  </button>
                </div>
              </form>
            </section>

            <h2 className="attendance-settings__section-title">{messages.settingsAllowances.listTitle}</h2>
            {data.definitions.length === 0 ? (
              <p className="attendance-settings__empty">{messages.settingsAllowances.empty}</p>
            ) : (
              data.definitions.map((def) => {
                const form = versionForms[def.id];
                if (!form) return null;
                return (
                  <section key={def.id} className="attendance-settings__section">
                    <h3 className="attendance-settings__section-title">{baseVersionFor(def)?.name ?? def.id}</h3>

                    {def.effective ? (
                      <div className="attendance-settings__current">
                        <div className="attendance-settings__current-row">
                          <span className="attendance-settings__current-label">{messages.settingsAllowances.currentConditionsLabel}</span>
                          <span className="attendance-settings__current-value">{summarizeAllowanceConditions(def.effective.conditions)}</span>
                        </div>
                        <p className="attendance-settings__current-effective-from tabular-nums">
                          {messages.settingsAllowances.currentEffectiveFrom}: {def.effective.effectiveFrom}
                        </p>
                      </div>
                    ) : (
                      <p className="attendance-settings__empty">{messages.settingsAllowances.noVersionYet}</p>
                    )}

                    <h4 className="attendance-settings__form-title">{messages.settingsAllowances.addVersionTitle}</h4>
                    <form className="attendance-settings__form" onSubmit={(e) => handleVersionSubmit(def.id, e)}>
                      <p className="attendance-settings__effective-hint">{messages.settingsAllowances.effectiveFromHint}</p>

                      <label className="attendance-settings__field">
                        <span>{messages.settingsAllowances.nameLabel}</span>
                        <input
                          type="text"
                          placeholder={messages.settingsAllowances.namePlaceholder}
                          value={form.name}
                          onChange={(e) =>
                            setVersionForms((prev) => ({ ...prev, [def.id]: { ...form, name: e.target.value } }))
                          }
                          required
                        />
                      </label>

                      <label className="attendance-settings__field">
                        <span>{messages.settingsAllowances.effectiveFromLabel}</span>
                        <input
                          type="date"
                          min={todayDate}
                          value={form.effectiveFrom}
                          onChange={(e) =>
                            setVersionForms((prev) => ({ ...prev, [def.id]: { ...form, effectiveFrom: e.target.value } }))
                          }
                          required
                        />
                      </label>

                      <AllowanceConditionsEditor
                        idPrefix={def.id}
                        value={form.conditions}
                        onChange={(conditions) => setVersionForms((prev) => ({ ...prev, [def.id]: { ...form, conditions } }))}
                      />

                      {versionErrors[def.id] ? (
                        <p className="correction-error" role="alert">
                          {versionErrors[def.id]}
                        </p>
                      ) : null}
                      {versionSuccess[def.id] ? (
                        <p className="attendance-settings__success">{messages.settingsAllowances.submitSuccess}</p>
                      ) : null}

                      <div className="attendance-settings__actions">
                        <button type="submit" className="k-modal__confirm k-modal__confirm--neutral" disabled={versionSaving[def.id]}>
                          {versionSaving[def.id] ? messages.settingsAllowances.addingVersion : messages.settingsAllowances.addVersionSubmit}
                        </button>
                      </div>
                    </form>

                    <h4 className="attendance-settings__form-title">{messages.settingsAllowances.historyTitle}</h4>
                    {def.history.length === 0 ? (
                      <p className="attendance-settings__empty">{messages.settingsAllowances.historyEmpty}</p>
                    ) : (
                      <div className="org-settings__table-wrap">
                        <table className="org-table">
                          <thead>
                            <tr>
                              <th>{messages.settingsAllowances.historyColumnEffectiveFrom}</th>
                              <th>{messages.settingsAllowances.historyColumnName}</th>
                              <th>{messages.settingsAllowances.historyColumnConditions}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...def.history].reverse().map((v) => (
                              <tr key={v.effectiveFrom}>
                                <td className="tabular-nums">{v.effectiveFrom}</td>
                                <td>{v.name}</td>
                                <td>{summarizeAllowanceConditions(v.conditions)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
