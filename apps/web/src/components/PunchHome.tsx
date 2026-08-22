"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type AttendanceCapabilitiesDto,
  type AttendanceState,
  type AttendanceStatus,
  type Punch,
  type PunchGpsInput,
  type PunchKind,
} from "../lib/api";
import { getCurrentPositionSafe } from "../lib/geolocation";
import { messages } from "../lib/messages";
import { formatTimeJst, jstTodayWindow } from "../lib/time";
import { useAuthGuard } from "../lib/useAuthGuard";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { AppHeader } from "./AppHeader";

const clockFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
  weekday: "short",
});

function clockParts(now: Date): { hm: string; ss: string } {
  const parts = clockFormatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { hm: `${get("hour")}:${get("minute")}`, ss: get("second") };
}

function chipVariant(kind: PunchKind): "in" | "break" | "out" {
  if (kind === "clock_in") return "in";
  if (kind === "clock_out") return "out";
  return "break";
}

export function PunchHome() {
  const router = useRouter();
  const guard = useAuthGuard();
  const isOnline = useOnlineStatus();

  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [punchError, setPunchError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [newChipId, setNewChipId] = useState<string | null>(null);
  const knownPunchIdsRef = useRef<Set<string> | null>(null);

  // GPS付き打刻(v0.4)。テナント設定は打刻ごとに変わるものではないため、マウント時に1回だけ取得する。
  const [capabilities, setCapabilities] = useState<AttendanceCapabilitiesDto | null>(null);
  const [gpsLocating, setGpsLocating] = useState(false);
  const [gpsUnavailableNote, setGpsUnavailableNote] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function refresh() {
    const { from, to } = jstTodayWindow();
    const [statusRes, punchesRes] = await Promise.all([api.status(), api.listPunches(from, to)]);
    setStatus(statusRes);
    setPunches(punchesRes.punches);
  }

  // 新しく追加された打刻チップだけに、トンボ列への追加アニメーションを適用する
  useEffect(() => {
    const knownIds = knownPunchIdsRef.current;
    const currentIds = new Set(punches.map((p) => p.id));
    if (knownIds) {
      const added = punches.find((p) => !knownIds.has(p.id));
      if (added) {
        setNewChipId(added.id);
        const timer = window.setTimeout(() => setNewChipId(null), 300);
        knownPunchIdsRef.current = currentIds;
        return () => window.clearTimeout(timer);
      }
    }
    knownPunchIdsRef.current = currentIds;
    return undefined;
  }, [punches]);

  useEffect(() => {
    if (guard.status !== "authed") return;
    let cancelled = false;
    refresh().catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setLoadError(true);
    });
    // GPSが有効かどうかは打刻の可否を左右しないため、失敗しても読み込みエラー扱いにはしない
    // (取得できなければ「GPSは無効」として扱い、通常どおり打刻できる)。
    api
      .getAttendanceCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ gpsEnabled: false, gpsRetentionDays: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard.status]);

  async function handlePunch(kind: PunchKind) {
    if (!isOnline) return; // ボタンは disabled のはずだが、念のための二重ガード
    setPending(true);
    setPunchError(null);
    setGpsUnavailableNote(false);
    try {
      let gps: PunchGpsInput | undefined;
      if (capabilities?.gpsEnabled) {
        setGpsLocating(true);
        const position = await getCurrentPositionSafe();
        setGpsLocating(false);
        if (position) {
          gps = { gpsLat: position.lat, gpsLng: position.lng };
        } else {
          // 許可されなかった/取得できなかった場合でも打刻自体は止めない(依頼どおり)。
          setGpsUnavailableNote(true);
        }
      }
      await api.punch(kind, gps);
      await refresh();
      setStamping(true);
      window.setTimeout(() => setStamping(false), 320);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setPunchError(err instanceof ApiError ? messages.errors.punchFailed : messages.errors.network);
    } finally {
      setPending(false);
      setGpsLocating(false);
    }
  }

  if (guard.status === "loading") {
    return <p className="monthly-loading">{messages.loading}</p>;
  }
  if (guard.status === "error" || !guard.user) {
    return <p className="monthly-error">{messages.errors.network}</p>;
  }

  const state: AttendanceState = status?.state ?? "out";
  const canClockIn = state === "out";
  const canBreak = state !== "out";
  const canClockOut = state !== "out";
  const breakKind: PunchKind = state === "onBreak" ? "break_end" : "break_start";
  const breakLabel = state === "onBreak" ? messages.punchButtons.breakEnd : messages.punchButtons.breakStart;

  const { hm, ss } = clockParts(now);

  return (
    <div className="punch-home">
      <AppHeader displayName={guard.user.displayName} email={guard.user.email} active="punch" />
      <main className="punch-home__main">
        <div className="punch-clock" aria-hidden="false">
          <span className="punch-clock__main tabular-nums" aria-label={`現在時刻 ${hm}分${ss}秒`}>
            {hm}
          </span>
          <span className="punch-clock__seconds tabular-nums">:{ss}</span>
        </div>
        <p className="punch-clock__date">{dateFormatter.format(now)}</p>

        <div className={`stamp stamp--${state}${stamping ? " stamp--stamping" : ""}`}>
          <span className="stamp__label">{messages.attendanceState[state]}</span>
        </div>

        {loadError ? <p className="punch-error">{messages.errors.loadFailed}</p> : null}
        {punchError ? (
          <p className="punch-error" role="alert">
            {punchError}
          </p>
        ) : null}
        {!isOnline ? (
          <p className="punch-offline-banner" role="status">
            {messages.offline.banner}
          </p>
        ) : null}

        {/* GPS取得中であることの明示(要件§3: 有効化時は従業員に取得中であることを明示する)。
            打刻ボタンの近くに常時表示し、詳細(理由・保持期間)は開閉式で添える。 */}
        {capabilities?.gpsEnabled ? (
          <div className="punch-gps-notice">
            <p className="punch-gps-notice__text">
              {messages.punchGps.noticeAlways}
              {gpsLocating ? <span className="punch-gps-notice__locating"> {messages.punchGps.locating}</span> : null}
            </p>
            <details className="punch-gps-notice__detail">
              <summary>{messages.punchGps.detailToggle}</summary>
              <p>{messages.punchGps.reason}</p>
              <p>
                {messages.punchGps.retentionPrefix}
                {capabilities.gpsRetentionDays === null
                  ? messages.punchGps.retentionSameAsAttendance
                  : `${capabilities.gpsRetentionDays}${messages.punchGps.retentionDaysSuffix}`}
              </p>
            </details>
          </div>
        ) : null}
        {gpsUnavailableNote ? <p className="punch-gps-notice__unavailable">{messages.punchGps.unavailableNote}</p> : null}

        <div className="punch-pad">
          <button
            type="button"
            className="punch-button punch-button--in"
            disabled={!canClockIn || pending || !isOnline}
            onClick={() => handlePunch("clock_in")}
          >
            <span>{messages.punchButtons.clockIn}</span>
          </button>
          <button
            type="button"
            className="punch-button punch-button--break"
            disabled={!canBreak || pending || !isOnline}
            onClick={() => handlePunch(breakKind)}
          >
            <span>{breakLabel}</span>
          </button>
          <button
            type="button"
            className="punch-button punch-button--out"
            disabled={!canClockOut || pending || !isOnline}
            onClick={() => handlePunch("clock_out")}
          >
            <span>{messages.punchButtons.clockOut}</span>
          </button>
          <div className="punch-pad__hint" aria-hidden="true">
            <span>{!isOnline ? messages.offline.punchDisabledHint : !canClockIn ? messages.punchHints.clockInDisabled : " "}</span>
            <span>{!isOnline ? messages.offline.punchDisabledHint : !canBreak ? messages.punchHints.breakDisabled : " "}</span>
            <span>{!isOnline ? messages.offline.punchDisabledHint : !canClockOut ? messages.punchHints.clockOutDisabled : " "}</span>
          </div>
        </div>

        <section className="tombo-row" aria-label={messages.today.title}>
          <p className="tombo-row__title">{messages.today.title}</p>
          {punches.length === 0 ? (
            <p className="tombo-row__empty">{messages.today.empty}</p>
          ) : (
            <ul className="tombo-row__list">
              {punches.map((p) => (
                <li
                  key={p.id}
                  className={`tombo-chip tombo-chip--${chipVariant(p.kind)}${p.id === newChipId ? " tombo-chip--new" : ""}`}
                >
                  <span className="tombo-chip__kind">{messages.punchKindLabel[p.kind]}</span>
                  <span className="tombo-chip__time tabular-nums">{formatTimeJst(p.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
