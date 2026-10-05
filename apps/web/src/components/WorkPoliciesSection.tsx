"use client";

import { useState } from "react";
import {
  api,
  ApiError,
  UnauthorizedError,
  type CoreTimeDto,
  type CreateWorkPolicyVersionInput,
  type FlexTotalHoursBasis,
  type WorkPoliciesDto,
  type WorkPolicyDto,
  type WorkPolicyVersionDto,
  type WorkSystemKind,
} from "../lib/api";
import { mapWorkPolicyErrorMessage, messages } from "../lib/messages";
import { formatEffectiveFrom } from "../lib/effective-from";
import { formatDurationHm, hmToMinutes, minutesToHm } from "../lib/time";
import { HelpTip } from "./HelpTip";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Notice } from "./ui/Notice";

// モジュールレベルで messages のプロパティを取り出して定数化すると、import 時の言語で凍結され
// 言語切替に追従しない(SettingsAttendanceView 冒頭のコメントと同じ理由)。描画時に毎回引く。
const weekdayLabel = (w: 0 | 1 | 2 | 3 | 4 | 5 | 6): string => messages.settingsAttendance.weekdayLabel[w];
const kindLabel = (kind: WorkSystemKind): string => messages.monthly.workSystemValue[kind];

/**
 * `CoreTime.weekdays` を省略したときにエンジンが使う既定(月〜金)。
 * packages/engine/src/core-time.ts の DEFAULT_CORE_WEEKDAYS と同じ値
 * (表示・初期選択のためだけに UI 側にも持つ。判定そのものはエンジンの1箇所で行う)。
 */
const DEFAULT_CORE_WEEKDAYS: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5];

const ALL_WEEKDAYS: ReadonlyArray<0 | 1 | 2 | 3 | 4 | 5 | 6> = [0, 1, 2, 3, 4, 5, 6];

/**
 * 1日の所定の上限(分)。固定時間制は 480 分(1日8時間を超える所定は固定時間制では設定できない —
 * apps/api/src/routes/settings/work-policy-version-input.ts の FIXED_MAX_STANDARD_DAY_MINUTES と同じ)。
 * フレックス(標準労働時間)と変形(有給換算用の基準所定)は 1440 分のまま。
 */
function maxStandardDayMinutes(kind: WorkSystemKind): number {
  return kind === "fixed" ? 480 : 1440;
}

/** コアタイムの要約("10:00〜15:00(月・火・…)" または「コアタイムなし」)。 */
export function summarizeCoreTime(core: CoreTimeDto | null): string {
  if (!core) return messages.settingsAttendance.coreTimeNone;
  const weekdays = (core.weekdays ?? DEFAULT_CORE_WEEKDAYS).map((w) => weekdayLabel(w)).join("・");
  return messages.settingsAttendance.coreTimeSummary(minutesToHm(core.startMinutes), minutesToHm(core.endMinutes), weekdays);
}

/**
 * 1日の所定の表示("6:00(360分)")。変形労働時間制で基準所定が 0(未設定)のときは、所定は日ごとの
 * シフトで決まる旨を出す("0:00(0分)" と出すと所定が0時間のように読めるため)。
 */
function formatStandardDay(kind: WorkSystemKind, minutes: number): string {
  if (kind === "monthly_variable" && minutes === 0) return messages.settingsWorkPolicies.standardDayByShift;
  return messages.settingsWorkPolicies.standardDayValue(formatDurationHm(minutes), minutes);
}

/** フレックスの総労働時間の決め方(2026-10-05)の表示 */
function basisLabel(basis: FlexTotalHoursBasis): string {
  return messages.settingsWorkPolicies.totalHoursBasisValue[basis];
}

/** 不足の繰越の表示 */
function carryLabel(carry: boolean): string {
  return carry ? messages.settingsWorkPolicies.carryOverShortfallValue.on : messages.settingsWorkPolicies.carryOverShortfallValue.off;
}

/** 版の履歴の「内容」欄。 */
function summarizeVersion(v: WorkPolicyVersionDto): string {
  const parts = [
    kindLabel(v.kind),
    `${messages.settingsWorkPolicies.standardDayLabel[v.kind]}: ${formatStandardDay(v.kind, v.standardDayMinutes)}`,
  ];
  if (v.kind === "flex") {
    parts.push(`${messages.settingsWorkPolicies.totalHoursBasisLabel}: ${basisLabel(v.totalHoursBasis)}`);
    if (v.totalHoursBasis === "scheduled_days") parts.push(`${messages.settingsWorkPolicies.carryOverShortfallLabel}: ${carryLabel(v.carryOverShortfall)}`);
    parts.push(`${messages.settingsAttendance.coreTimeLabel}: ${summarizeCoreTime(v.core)}`);
  }
  return parts.join(" / ");
}

/** 版の入力フォームの状態(制度の作成と版の追加で共通)。 */
interface VersionFormState {
  effectiveFrom: string;
  standardDayMinutes: string;
  /** コアタイムを設定するか(フレックスのみ。既定は「設定しない」= スーパーフレックス) */
  coreTimeEnabled: boolean;
  /** "HH:MM" */
  coreTimeStartHm: string;
  coreTimeEndHm: string;
  /** 曜日ごとの選択状態(index = 0..6、0=日曜) */
  coreTimeWeekdays: boolean[];
  /** フレックスの総労働時間の決め方(2026-10-05)。既定は法定の枠 */
  totalHoursBasis: FlexTotalHoursBasis;
  /** フレックスで不足を翌月に繰り越すか。"scheduled_days" のときだけ送る */
  carryOverShortfall: boolean;
}

function initialVersionForm(effectiveFrom: string, base: WorkPolicyVersionDto | null): VersionFormState {
  const core = base?.core ?? null;
  const selected = core?.weekdays ?? DEFAULT_CORE_WEEKDAYS;
  return {
    effectiveFrom,
    standardDayMinutes: base ? String(base.standardDayMinutes) : "480",
    coreTimeEnabled: core !== null,
    coreTimeStartHm: core ? minutesToHm(core.startMinutes) : "10:00",
    coreTimeEndHm: core ? minutesToHm(core.endMinutes) : "15:00",
    coreTimeWeekdays: ALL_WEEKDAYS.map((w) => selected.includes(w)),
    totalHoursBasis: base?.kind === "flex" ? base.totalHoursBasis : "statutory_frame",
    carryOverShortfall: base?.kind === "flex" ? base.carryOverShortfall : false,
  };
}

/**
 * フォームの値 → API の版の入力。不正なら API と同じエラーコードを返す(画面の文言はサーバーの
 * エラーと同じ mapWorkPolicyErrorMessage で引く)。範囲・前後関係の最終判定はサーバー側。
 */
function buildVersionInput(kind: WorkSystemKind, form: VersionFormState): CreateWorkPolicyVersionInput | { error: string } {
  const standardDayMinutes = Number(form.standardDayMinutes);
  if (!Number.isInteger(standardDayMinutes) || standardDayMinutes < 1 || standardDayMinutes > maxStandardDayMinutes(kind)) {
    return { error: "invalid_standard_day_minutes" };
  }
  if (kind !== "flex") return { effectiveFrom: form.effectiveFrom, kind, standardDayMinutes };

  let core: CoreTimeDto | null = null;
  if (form.coreTimeEnabled) {
    const startMinutes = hmToMinutes(form.coreTimeStartHm);
    const endMinutes = hmToMinutes(form.coreTimeEndHm);
    if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) return { error: "invalid_core_time" };
    const weekdays = ALL_WEEKDAYS.filter((w) => form.coreTimeWeekdays[w]);
    if (weekdays.length === 0) return { error: "invalid_core_time_weekdays" };
    core = { startMinutes, endMinutes, weekdays };
  }
  return {
    effectiveFrom: form.effectiveFrom,
    kind,
    settlementPeriod: "monthly",
    core,
    standardDayMinutes,
    totalHoursBasis: form.totalHoursBasis,
    // 繰越は「所定日数 × 標準時間」のときだけ意味を持つ(API も他の組み合わせを 400 にする)
    carryOverShortfall: form.totalHoursBasis === "scheduled_days" && form.carryOverShortfall,
  };
}

function standardDayHint(kind: WorkSystemKind): string {
  if (kind === "fixed") return messages.settingsWorkPolicies.fixedStandardDayHint;
  if (kind === "flex") return messages.settingsWorkPolicies.flexStandardDayHint;
  return messages.settingsWorkPolicies.variableStandardDayHint;
}

/** 版の中身の入力欄(所定と、フレックスならコアタイム)。制度の作成と版の追加で共通。 */
function VersionFields({
  idPrefix,
  kind,
  form,
  onChange,
}: {
  idPrefix: string;
  kind: WorkSystemKind;
  form: VersionFormState;
  onChange: (next: VersionFormState) => void;
}) {
  return (
    <>
      <Field label={messages.settingsWorkPolicies.standardDayMinutesLabel} htmlFor={`${idPrefix}-minutes`} hint={standardDayHint(kind)}>
        <input
          id={`${idPrefix}-minutes`}
          type="number"
          inputMode="numeric"
          className="tabular-nums"
          min={1}
          max={maxStandardDayMinutes(kind)}
          value={form.standardDayMinutes}
          onChange={(e) => onChange({ ...form, standardDayMinutes: e.target.value })}
          required
        />
      </Field>

      {/*
        総労働時間の決め方と不足の繰越(2026-10-05、時短勤務の第2段階)。既定は法定の枠(従来どおり)。
        繰越は「所定日数 × 標準時間」のときだけ選べる。
      */}
      {kind === "flex" ? (
        <fieldset className="field attendance-settings__field">
          <legend>
            {messages.settingsWorkPolicies.totalHoursBasisLabel}
            <HelpTip helpKey="attendance.flex-contract" />
          </legend>
          {(["statutory_frame", "scheduled_days"] as const).map((basis) => (
            <label key={basis} className="attendance-settings__radio attendance-settings__radio--with-hint">
              <input
                type="radio"
                name={`${idPrefix}-basis`}
                checked={form.totalHoursBasis === basis}
                onChange={() => onChange({ ...form, totalHoursBasis: basis })}
              />
              <span className="attendance-settings__radio-text">
                {basisLabel(basis)}
                <span className="attendance-settings__field-hint">{messages.settingsWorkPolicies.totalHoursBasisHint[basis]}</span>
              </span>
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={form.totalHoursBasis === "scheduled_days" && form.carryOverShortfall}
              disabled={form.totalHoursBasis !== "scheduled_days"}
              onChange={(e) => onChange({ ...form, carryOverShortfall: e.target.checked })}
            />
            <span>{messages.settingsWorkPolicies.carryOverShortfallCheckbox}</span>
          </label>
          <p className="attendance-settings__field-hint">{messages.settingsWorkPolicies.carryOverShortfallHint}</p>
        </fieldset>
      ) : null}

      {/* コアタイム(labor law §32-3)。フレックスの任意設定なので既定は「設定しない」= スーパーフレックス。 */}
      {kind === "flex" ? (
        <fieldset className="field attendance-settings__field">
          <legend>{messages.settingsAttendance.coreTimeLabel}</legend>
          <p className="attendance-settings__field-hint">{messages.settingsAttendance.coreTimeHint}</p>
          <label className="check">
            <input type="checkbox" checked={form.coreTimeEnabled} onChange={(e) => onChange({ ...form, coreTimeEnabled: e.target.checked })} />
            <span>{messages.settingsAttendance.coreTimeEnabledCheckbox}</span>
          </label>
          {form.coreTimeEnabled ? (
            <>
              <div className="field-row">
                <Field label={messages.settingsAttendance.coreTimeStartLabel} htmlFor={`${idPrefix}-core-start`}>
                  <input
                    id={`${idPrefix}-core-start`}
                    type="time"
                    value={form.coreTimeStartHm}
                    onChange={(e) => onChange({ ...form, coreTimeStartHm: e.target.value })}
                    required
                  />
                </Field>
                <Field label={messages.settingsAttendance.coreTimeEndLabel} htmlFor={`${idPrefix}-core-end`}>
                  <input
                    id={`${idPrefix}-core-end`}
                    type="time"
                    value={form.coreTimeEndHm}
                    onChange={(e) => onChange({ ...form, coreTimeEndHm: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <fieldset className="field attendance-settings__field">
                <legend>{messages.settingsAttendance.coreTimeWeekdaysLabel}</legend>
                <div className="attendance-settings__weekdays">
                  {ALL_WEEKDAYS.map((w) => (
                    <label key={w} className="check">
                      <input
                        type="checkbox"
                        checked={form.coreTimeWeekdays[w] ?? false}
                        onChange={() =>
                          onChange({ ...form, coreTimeWeekdays: form.coreTimeWeekdays.map((checked, idx) => (idx === w ? !checked : checked)) })
                        }
                      />
                      <span>{weekdayLabel(w)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
        </fieldset>
      ) : null}
    </>
  );
}

/** カード内で開いている操作(1度に1つだけ開く)。 */
type OpenPanel = { policyId: string; mode: "version" | "rename" } | null;

/** 直近の操作の結果表示。どの区画(制度のカード / 制度の追加)に出すかを持つ。 */
type Feedback = { target: string; tone: "success" | "danger"; text: string } | null;

const CREATE_TARGET = "create";

interface CreateFormState extends VersionFormState {
  name: string;
  kind: WorkSystemKind;
}

export interface WorkPoliciesSectionProps {
  /** 初回の GET /settings/work-policies の結果(親が勤怠ルールと一緒に取得する) */
  initial: WorkPoliciesDto;
  /** 今日("YYYY-MM-DD")。版の追加の適用開始日の下限 */
  todayDate: string;
  /** 版の追加フォームの適用開始日の初期値(親と同じ「翌月1日」) */
  defaultEffectiveFrom: string;
  /** 401(セッション切れ)のとき */
  onUnauthorized: () => void;
}

/**
 * 勤怠ルール画面の「労働時間制の制度」区画(2026-10-05、名前付きの制度 = 時短勤務対応の第1段階)。
 *
 * 制度ごとのカードに、名前・種類・現在の所定・割当人数・版の履歴を並べ、版の追加・名前の変更・
 * アーカイブをカードの中で行う。以前の「フレックス設定」区画(テナントに1本の制度の版を足すだけの
 * フォーム)は、この中の「フレックスの制度」のカードに統合した — コアタイムの設定はフレックスの
 * 制度のカードの版の追加にある。
 *
 * docs/design/v01-data-model.md 原則6(effective-dated)は勤怠ルールの他の区画と同じ:
 * 版の追加フォームには「過去の集計は変わらない」ことを必ず添える。制度の削除は無い
 * (版と割当の履歴が参照するため)。代わりにアーカイブで新しい割当の選択肢から外す。
 */
export function WorkPoliciesSection({ initial, todayDate, defaultEffectiveFrom, onUnauthorized }: WorkPoliciesSectionProps) {
  const [data, setData] = useState<WorkPoliciesDto>(initial);
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [versionForm, setVersionForm] = useState<VersionFormState>(() => initialVersionForm(defaultEffectiveFrom, null));
  const [renameValue, setRenameValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(() => ({
    ...initialVersionForm(todayDate, null),
    name: "",
    kind: "fixed",
  }));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  /** 操作の後は一覧を取り直す(割当人数・既定・版の並びはサーバーが決めるため、手元で組み立てない)。 */
  async function run(target: string, action: () => Promise<unknown>, successText: string): Promise<boolean> {
    setSaving(true);
    setFeedback(null);
    try {
      await action();
      setData(await api.listWorkPolicies());
      setFeedback({ target, tone: "success", text: successText });
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return false;
      }
      setFeedback({ target, tone: "danger", text: err instanceof ApiError ? mapWorkPolicyErrorMessage(err.body) : messages.errors.network });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openVersion(policy: WorkPolicyDto) {
    setFeedback(null);
    setOpenPanel({ policyId: policy.id, mode: "version" });
    // 今の値を初期値にする(所定だけを変える版の追加が多いため。コアタイムも引き継ぐ)
    setVersionForm(initialVersionForm(defaultEffectiveFrom, policy.effective ?? policy.history[policy.history.length - 1] ?? null));
  }

  function openRename(policy: WorkPolicyDto) {
    setFeedback(null);
    setOpenPanel({ policyId: policy.id, mode: "rename" });
    setRenameValue(policy.name);
  }

  async function handleVersionSubmit(e: React.FormEvent, policy: WorkPolicyDto, kind: WorkSystemKind) {
    e.preventDefault();
    const input = buildVersionInput(kind, versionForm);
    if ("error" in input) {
      setFeedback({ target: policy.id, tone: "danger", text: mapWorkPolicyErrorMessage(input) });
      return;
    }
    const ok = await run(policy.id, () => api.addWorkPolicyVersion(policy.id, input), messages.settingsWorkPolicies.versionSuccess);
    if (ok) setOpenPanel(null);
  }

  async function handleRenameSubmit(e: React.FormEvent, policy: WorkPolicyDto) {
    e.preventDefault();
    const ok = await run(policy.id, () => api.updateWorkPolicy(policy.id, { name: renameValue }), messages.settingsWorkPolicies.renameSuccess);
    if (ok) setOpenPanel(null);
  }

  async function handleArchiveToggle(policy: WorkPolicyDto) {
    setOpenPanel(null);
    const archive = policy.archivedAt === null;
    await run(
      policy.id,
      () => api.updateWorkPolicy(policy.id, { archived: archive }),
      archive ? messages.settingsWorkPolicies.archiveSuccess : messages.settingsWorkPolicies.unarchiveSuccess,
    );
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildVersionInput(createForm.kind, createForm);
    if ("error" in input) {
      setFeedback({ target: CREATE_TARGET, tone: "danger", text: mapWorkPolicyErrorMessage(input) });
      return;
    }
    const ok = await run(CREATE_TARGET, () => api.createWorkPolicy({ ...input, name: createForm.name }), messages.settingsWorkPolicies.createSuccess);
    if (ok) {
      setCreateOpen(false);
      setCreateForm({ ...initialVersionForm(todayDate, null), name: "", kind: "fixed" });
    }
  }

  function feedbackFor(target: string) {
    if (!feedback || feedback.target !== target) return null;
    return (
      <Notice tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>
        {feedback.text}
      </Notice>
    );
  }

  // 使用中の制度を先に、アーカイブ済みを後に並べる(どちらも作成順 = API の並び)。
  const policies = [...data.policies.filter((p) => p.archivedAt === null), ...data.policies.filter((p) => p.archivedAt !== null)];

  return (
    <section className="attendance-settings__section">
      <h2 className="attendance-settings__section-title">
        {messages.settingsWorkPolicies.sectionTitle}
        <HelpTip helpKey="attendance.work-system" />
      </h2>
      <p className="section-lead">{messages.settingsWorkPolicies.sectionLead}</p>

      {policies.length === 0 ? <p className="attendance-settings__empty">{messages.settingsWorkPolicies.empty}</p> : null}

      {policies.map((policy) => {
        const kind = policy.kind;
        const current = policy.effective;
        const panel = openPanel?.policyId === policy.id ? openPanel.mode : null;
        const idPrefix = `work-policy-${policy.id}`;
        return (
          <article key={policy.id} className="card" aria-labelledby={`${idPrefix}-title`}>
            <h3 id={`${idPrefix}-title`} className="card__title">
              {policy.name}
            </h3>
            <div className="badge-row">
              {kind ? <Badge tone="neutral">{kindLabel(kind)}</Badge> : null}
              {policy.isDefault ? <Badge tone="key">{messages.settingsWorkPolicies.defaultBadge}</Badge> : null}
              {policy.archivedAt !== null ? (
                <Badge tone="neutral" className="badge--dashed">
                  {messages.settingsWorkPolicies.archivedBadge}
                </Badge>
              ) : null}
            </div>
            {policy.isDefault ? <p className="card__lead">{messages.settingsWorkPolicies.defaultHint}</p> : null}

            {current ? (
              <div className="attendance-settings__current">
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">
                    {messages.settingsWorkPolicies.standardDayLabel[current.kind]}
                    {current.kind === "fixed" ? <HelpTip helpKey="attendance.fixed-overtime" /> : null}
                    {current.kind === "flex" ? <HelpTip helpKey="attendance.flex-frame" /> : null}
                  </span>
                  <span className="attendance-settings__current-value tabular-nums">{formatStandardDay(current.kind, current.standardDayMinutes)}</span>
                </div>
                {current.kind === "flex" ? (
                  <>
                    <div className="attendance-settings__current-row">
                      <span className="attendance-settings__current-label">
                        {messages.settingsWorkPolicies.totalHoursBasisLabel}
                        <HelpTip helpKey="attendance.flex-contract" />
                      </span>
                      <span className="attendance-settings__current-value">{basisLabel(current.totalHoursBasis)}</span>
                    </div>
                    {current.totalHoursBasis === "scheduled_days" ? (
                      <div className="attendance-settings__current-row">
                        <span className="attendance-settings__current-label">{messages.settingsWorkPolicies.carryOverShortfallLabel}</span>
                        <span className="attendance-settings__current-value">{carryLabel(current.carryOverShortfall)}</span>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {current.kind === "flex" ? (
                  <div className="attendance-settings__current-row">
                    <span className="attendance-settings__current-label">{messages.settingsAttendance.coreTimeLabel}</span>
                    <span className="attendance-settings__current-value">{summarizeCoreTime(current.core)}</span>
                  </div>
                ) : null}
                <div className="attendance-settings__current-row">
                  <span className="attendance-settings__current-label">{messages.settingsWorkPolicies.assigneeCountLabel}</span>
                  <span className="attendance-settings__current-value tabular-nums">
                    {messages.settingsWorkPolicies.assigneeCountValue(policy.assigneeCount)}
                  </span>
                </div>
                <p className="attendance-settings__current-effective-from tabular-nums">
                  {messages.settingsWorkPolicies.currentEffectiveFrom}: {formatEffectiveFrom(current.effectiveFrom)}
                </p>
              </div>
            ) : (
              <p className="attendance-settings__empty">{messages.settingsWorkPolicies.notEffectiveYet}</p>
            )}

            <div className="btn-row">
              {kind ? (
                <Button variant="secondary" size="sm" onClick={() => openVersion(policy)} disabled={saving} aria-expanded={panel === "version"}>
                  {messages.settingsWorkPolicies.addVersionButton}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => openRename(policy)} disabled={saving} aria-expanded={panel === "rename"}>
                {messages.settingsWorkPolicies.renameButton}
              </Button>
              {!policy.isDefault ? (
                <Button variant="ghost" size="sm" onClick={() => handleArchiveToggle(policy)} disabled={saving}>
                  {policy.archivedAt === null ? messages.settingsWorkPolicies.archiveButton : messages.settingsWorkPolicies.unarchiveButton}
                </Button>
              ) : null}
            </div>
            {!policy.isDefault && policy.archivedAt === null ? (
              <p className="field__hint">{messages.settingsWorkPolicies.archiveHint}</p>
            ) : null}

            {panel === "version" && kind ? (
              <form className="attendance-settings__form" onSubmit={(e) => handleVersionSubmit(e, policy, kind)}>
                <h4 className="attendance-settings__form-title">{messages.settingsWorkPolicies.addVersionTitle}</h4>
                <Notice tone="caution">
                  {messages.settingsAttendance.effectiveFromHint}
                  <HelpTip helpKey="law.versioning" />
                </Notice>
                <Field label={messages.settingsAttendance.effectiveFromLabel} htmlFor={`${idPrefix}-effective-from`}>
                  <input
                    id={`${idPrefix}-effective-from`}
                    type="date"
                    min={todayDate}
                    value={versionForm.effectiveFrom}
                    onChange={(e) => setVersionForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                    required
                  />
                </Field>
                <VersionFields idPrefix={idPrefix} kind={kind} form={versionForm} onChange={setVersionForm} />
                <div className="btn-row">
                  <Button type="submit" variant="primary" disabled={saving}>
                    {saving ? messages.settingsWorkPolicies.submitting : messages.settingsAttendance.submit}
                  </Button>
                  <Button variant="ghost" onClick={() => setOpenPanel(null)} disabled={saving}>
                    {messages.settingsWorkPolicies.cancel}
                  </Button>
                </div>
              </form>
            ) : null}

            {panel === "rename" ? (
              <form className="attendance-settings__form" onSubmit={(e) => handleRenameSubmit(e, policy)}>
                <Field label={messages.settingsWorkPolicies.nameLabel} htmlFor={`${idPrefix}-name`}>
                  <input
                    id={`${idPrefix}-name`}
                    type="text"
                    maxLength={100}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    required
                  />
                </Field>
                <div className="btn-row">
                  <Button type="submit" variant="primary" disabled={saving}>
                    {saving ? messages.settingsWorkPolicies.submitting : messages.settingsWorkPolicies.renameSubmit}
                  </Button>
                  <Button variant="ghost" onClick={() => setOpenPanel(null)} disabled={saving}>
                    {messages.settingsWorkPolicies.cancel}
                  </Button>
                </div>
              </form>
            ) : null}

            {feedbackFor(policy.id)}

            <h4 className="attendance-settings__form-title">{messages.settingsWorkPolicies.historyTitle}</h4>
            <div className="org-settings__table-wrap">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>{messages.settingsWorkPolicies.historyColumnEffectiveFrom}</th>
                    <th>{messages.settingsWorkPolicies.historyColumnSummary}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...policy.history].reverse().map((v) => (
                    <tr key={v.effectiveFrom}>
                      <td className="tabular-nums">{formatEffectiveFrom(v.effectiveFrom)}</td>
                      <td>{summarizeVersion(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}

      {createOpen ? (
        <form className="attendance-settings__form" onSubmit={handleCreateSubmit}>
          <h3 className="attendance-settings__form-title">{messages.settingsWorkPolicies.addPolicyTitle}</h3>
          <Field label={messages.settingsWorkPolicies.nameLabel} htmlFor="work-policy-create-name">
            <input
              id="work-policy-create-name"
              type="text"
              maxLength={100}
              placeholder={messages.settingsWorkPolicies.namePlaceholder}
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </Field>
          <Field label={messages.settingsWorkPolicies.kindSelectLabel} htmlFor="work-policy-create-kind">
            <select
              id="work-policy-create-kind"
              value={createForm.kind}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, kind: e.target.value as WorkSystemKind }))}
            >
              <option value="fixed">{kindLabel("fixed")}</option>
              <option value="flex">{kindLabel("flex")}</option>
              <option value="monthly_variable">{kindLabel("monthly_variable")}</option>
            </select>
          </Field>
          <Field
            label={messages.settingsWorkPolicies.initialEffectiveFromLabel}
            htmlFor="work-policy-create-effective-from"
            hint={messages.settingsWorkPolicies.initialEffectiveFromHint}
          >
            <input
              id="work-policy-create-effective-from"
              type="date"
              value={createForm.effectiveFrom}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
              required
            />
          </Field>
          <VersionFields
            idPrefix="work-policy-create"
            kind={createForm.kind}
            form={createForm}
            onChange={(next) => setCreateForm((prev) => ({ ...prev, ...next }))}
          />
          {feedbackFor(CREATE_TARGET)}
          <div className="btn-row">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? messages.settingsWorkPolicies.submitting : messages.settingsWorkPolicies.createSubmit}
            </Button>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              {messages.settingsWorkPolicies.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="btn-row">
            <Button
              variant="secondary"
              onClick={() => {
                setFeedback(null);
                setOpenPanel(null);
                setCreateOpen(true);
              }}
              disabled={saving}
            >
              {messages.settingsWorkPolicies.addPolicyButton}
            </Button>
          </div>
          {feedbackFor(CREATE_TARGET)}
        </>
      )}
    </section>
  );
}
