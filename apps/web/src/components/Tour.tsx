"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "waku";
import type { Unstable_RouteHref as RouteHref } from "waku/router/client";
import { messages } from "../lib/messages";
import { hasEffectivePermission } from "../lib/permissions";
import {
  audienceFor,
  cutoutRect,
  isTourablePath,
  keyToMove,
  moveIndex,
  needsScrollIntoView,
  placeTooltip,
  readTourDone,
  readTourProgress,
  stepNumber,
  stepsFor,
  writeTourDone,
  writeTourProgress,
  type Rect,
  type TooltipPosition,
  type TourStep,
} from "../lib/tour";
import { useEffectivePermissions } from "../lib/useEffectivePermissions";

/**
 * 初回ログイン時の「使い方ツアー」(2026-08-27 追加、docs/requirements.md §11「以降」)。
 *
 * 手順の定義・状態遷移・位置計算は lib/tour.ts(純関数)にあり、ここはその結果を DOM に
 * 置くだけの層に留める。外部ライブラリ(driver.js 等)は入れない — 必要なのは
 * 「暗幕+切り抜き+吹き出し」だけで、既存のデザイントークン(紙白/キー/シアン)に
 * 合わせるほうが依存を増やすより早い(このリポジトリは依存を増やさない方針)。
 *
 * 配置: `pages/_layout.tsx` の LocaleGate の内側に1つだけ置く。
 * - 内側に置くのは、言語切り替えでツアーの文言も差し替わるようにするため
 *   (LocaleGate は locale が変わると子ツリーを丸ごと再マウントする)。再マウントで
 *   途中の手順を失わないよう、進捗は sessionStorage に持つ(lib/tour.ts 参照)。
 * - ページを跨ぐ手順(月次・申請・設定)があるため、各画面ではなくレイアウトに置く。
 *   ログイン前の画面(/login, /invite/*, /reset/*)では何も描画しない(isTourablePath)。
 */

/** 対象要素の出現を待つ間隔と上限(合計 約2秒)。見つからなければその手順は飛ばす。 */
const TARGET_POLL_MS = 100;
const TARGET_MAX_TRIES = 20;

/** 「もう一度ツアーを見る」の購読者(SettingsHubView のリンクから起動する)。 */
const restartListeners = new Set<() => void>();

function localStorageSafe(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function sessionStorageSafe(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * ツアーをもう一度最初から見る(設定ハブの「使い方ツアーを見る」から呼ぶ)。
 * 完了記録を消し、マウント済みの Tour に開始を通知する。最初の手順はダッシュボードのため、
 * Tour 側が自動でそのページへ遷移する。
 */
export function restartTour(): void {
  writeTourDone(localStorageSafe(), false);
  writeTourProgress(sessionStorageSafe(), null);
  for (const listener of restartListeners) listener();
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function toRect(domRect: DOMRect): Rect {
  return { top: domRect.top, left: domRect.left, width: domRect.width, height: domRect.height };
}

export function Tour() {
  const router = useRouter();
  // ログイン前の画面ではツアーの機構ごと動かさない(権限 API も叩かない)。
  if (!isTourablePath(router.path)) return <TourIdle />;
  return <TourRunner path={router.path} navigate={router.push} />;
}

/**
 * ツアーを動かさないページ用の何もしない実体。ログアウト等でログイン画面に戻ったとき、
 * 途中まで進んだ記録を消して次回のログインで最初から始められるようにするためだけに置く
 * (フックの数をページ間で揃える意図はない — Tour は path が変わると別の枝を描画するため、
 * どちらの枝も自前でフックを閉じている)。
 */
function TourIdle() {
  useEffect(() => {
    writeTourProgress(sessionStorageSafe(), null);
  }, []);
  return null;
}

type Phase = "idle" | "running" | "closed";

function TourRunner({ path, navigate }: { path: string; navigate: (to: RouteHref) => Promise<void> }) {
  const { loading, permissions } = useEffectivePermissions();
  const audience = audienceFor(hasEffectivePermission(permissions, "member.invite", "department"));
  const [steps, setSteps] = useState<TourStep[]>(() => stepsFor("member"));
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(0);
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPosition | null>(null);
  /** 直前の操作方向。対象が見つからない手順を飛ばすとき、同じ方向へ進み続けるために使う。 */
  const directionRef = useRef<1 | -1>(1);
  /** 自動開始かどうか。自動開始で最初の手順すら出せない(=まだ画面が整っていない)なら黙って諦める。 */
  const autoStartedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  /**
   * router.push は毎レンダリングで新しい関数になりうるため、対象要素を待つ effect の依存に
   * 直接入れない(入れると待機ループが毎回作り直され、いつまでも「見つからない」判定に
   * 到達できなくなる)。
   */
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // 実効権限が確定したら手順一覧を確定させる(管理者には設定系の手順が加わる)。
  useEffect(() => {
    if (loading) return;
    setSteps(stepsFor(audience));
  }, [loading, audience]);

  // 開始・再開の判定。実効権限が確定するまでは何もしない(手順数が変わるため)。
  useEffect(() => {
    if (loading || phase !== "idle") return;
    const resumed = readTourProgress(sessionStorageSafe(), steps);
    if (resumed !== null) {
      autoStartedRef.current = false;
      setIndex(resumed);
      setPhase("running");
      return;
    }
    if (readTourDone(localStorageSafe())) {
      setPhase("closed");
      return;
    }
    /*
     * 自動開始は「1手順目のページ(ダッシュボード)を開いているとき」だけにする。
     * ログイン直後の行き先はダッシュボードのため通常はここで始まるが、打刻画面などを
     * ブックマークから直接開いた人をいきなり別のページへ連れて行かないための歯止め
     * (「使い方ツアーを見る」からの明示的な再実行では、この制限は掛けない)。
     */
    if (path !== steps[0]?.path) return;
    autoStartedRef.current = true;
    setIndex(0);
    setPhase("running");
  }, [loading, phase, steps, path]);

  // 「使い方ツアーを見る」からの再開。
  useEffect(() => {
    function handleRestart() {
      autoStartedRef.current = false;
      directionRef.current = 1;
      setTargetEl(null);
      setRect(null);
      setTooltip(null);
      setIndex(0);
      setPhase("running");
    }
    restartListeners.add(handleRestart);
    return () => {
      restartListeners.delete(handleRestart);
    };
  }, []);

  const close = useCallback((completed: boolean) => {
    // 完了もスキップも「もう自動では出さない」で同じ扱い(何度も出すほうが煩わしい)。
    if (completed) writeTourDone(localStorageSafe(), true);
    writeTourProgress(sessionStorageSafe(), null);
    setPhase("closed");
    setTargetEl(null);
    setRect(null);
    setTooltip(null);
  }, []);

  const move = useCallback(
    (direction: 1 | -1) => {
      directionRef.current = direction;
      const next = moveIndex(index, steps.length, direction);
      if (next === null) {
        close(true);
        return;
      }
      setTargetEl(null);
      setRect(null);
      setTooltip(null);
      setIndex(next);
    },
    [index, steps.length, close],
  );

  // 現在の手順のページへ移動し、対象要素が現れるのを待つ。現れなければその手順は飛ばす
  // (権限で消えるボタン等 — 手順が壊れて止まらないことを優先する)。
  useEffect(() => {
    if (phase !== "running") return;
    const step = steps[index];
    if (!step) return;

    writeTourProgress(sessionStorageSafe(), step);

    if (step.path !== path) {
      void navigateRef.current(step.path);
      return;
    }

    // 関数宣言(巻き上げ)の中では step の絞り込みが効かないため、必要な値だけ取り出しておく。
    const selector = `[data-tour="${step.target}"]`;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        setTargetEl(el);
        return;
      }
      tries += 1;
      if (tries >= TARGET_MAX_TRIES) {
        // 自動開始の1手順目が出せないのは「まだログイン確認中/未ログイン」の可能性が高い。
        // 完了扱いにはせず、次のページ読み込みでまたやり直せるようにして静かに閉じる。
        if (index === 0 && autoStartedRef.current) {
          writeTourProgress(sessionStorageSafe(), null);
          setPhase("closed");
          return;
        }
        move(directionRef.current);
        return;
      }
      timer = setTimeout(tick, TARGET_POLL_MS);
    }
    tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [phase, index, path, steps, move]);

  /*
   * 対象の位置を毎フレーム測り直す(値が動いたときだけ state を更新する)。
   *
   * scroll / resize のイベント購読だけでは足りない: ダッシュボードの「要対応」カードのように
   * 中身を非同期に取得して伸び縮みする枠だと、最初の1回だけ測ると読み込み中の小さな矩形を
   * 掴んだまま固まってしまう(実際に撮影で発覚 — 2026-08-27)。ResizeObserver も、対象より
   * 上の要素が伸びて「対象が下へ押し出される」場合には発火しないため決め手にならない。
   * requestAnimationFrame で測り直すのが一番素直で、ツアー表示中だけの負荷で済む。
   *
   * スクロールは「矩形が数フレーム動かなくなってから」だけ行う(読み込み中の途中経過で
   * 飛び回らないようにする)。試行は2回までに制限し、対象が画面より大きい場合などに
   * 延々とスクロールし続けないようにする。
   */
  useEffect(() => {
    if (!targetEl) return;
    const MAX_SCROLL_ATTEMPTS = 2;
    const STABLE_FRAMES = 3;
    let raf = 0;
    let last: Rect | null = null;
    let stableFrames = 0;
    let scrollAttempts = 0;

    function tick() {
      if (!targetEl) return;
      const next = toRect(targetEl.getBoundingClientRect());
      const moved =
        last === null ||
        Math.abs(next.top - last.top) > 0.5 ||
        Math.abs(next.left - last.left) > 0.5 ||
        Math.abs(next.width - last.width) > 0.5 ||
        Math.abs(next.height - last.height) > 0.5;
      if (moved) {
        stableFrames = 0;
        setRect(next);
      } else {
        stableFrames += 1;
      }
      last = next;

      if (
        stableFrames === STABLE_FRAMES &&
        scrollAttempts < MAX_SCROLL_ATTEMPTS &&
        needsScrollIntoView(next, { width: window.innerWidth, height: window.innerHeight })
      ) {
        scrollAttempts += 1;
        stableFrames = 0;
        // 画面より背の高い対象(設定フォーム・要対応カード)は中央寄せにすると見出しが
        // 上に切れてしまうため、上端を合わせる。
        const tall = next.height > window.innerHeight - 48;
        targetEl.scrollIntoView({
          block: tall ? "start" : "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetEl]);

  /*
   * 吹き出しの位置。カードの実寸(文言の長さで変わる)を測ってから決めるため、描画後に計算する。
   * useLayoutEffect ではなく useEffect にしているのは、この画面が静的書き出し(サーバー描画)を
   * 通るため — 位置が決まるまでカードは visibility: hidden で置いてあり、ちらつきは出ない。
   */
  useEffect(() => {
    const step = steps[index];
    if (!rect || !cardRef.current || !step) return;
    const card = cardRef.current.getBoundingClientRect();
    setTooltip(
      placeTooltip(
        rect,
        { width: card.width, height: card.height },
        { width: window.innerWidth, height: window.innerHeight },
        step.placement,
      ),
    );
  }, [rect, index, steps]);

  // キーボード操作(Esc=スキップ、←→=戻る/進む)と、カード内へのフォーカス閉じ込め。
  useEffect(() => {
    if (phase !== "running" || !rect) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab") {
        const focusables = cardRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const activeEl = document.activeElement;
        if (e.shiftKey && (activeEl === first || !cardRef.current?.contains(activeEl))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const action = keyToMove(e.key);
      if (!action) return;
      e.preventDefault();
      if (action === "skip") close(true);
      else move(action === "next" ? 1 : -1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [phase, rect, close, move]);

  // 手順が変わるたびにカードへフォーカスを移す(読み上げの起点をそろえ、Tab の閉じ込めを成立させる)。
  useEffect(() => {
    if (phase !== "running" || !rect) return;
    cardRef.current?.focus();
  }, [phase, rect, index]);

  const step = steps[index];
  if (phase !== "running" || !step || !rect) return null;

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const cutout = cutoutRect(rect, viewport);
  const text = messages.tour.steps[step.id];
  const isLast = index === steps.length - 1;

  return (
    <div className="tour" role="presentation">
      {/* 操作を止める幕。暗さは切り抜き側の box-shadow が担うため、この層は透明のまま。 */}
      <div className="tour__blocker" />
      <div
        className="tour__cutout"
        style={{ top: `${cutout.top}px`, left: `${cutout.left}px`, width: `${cutout.width}px`, height: `${cutout.height}px` }}
      />
      <div
        className={`tour__card tour__card--${tooltip?.placement ?? step.placement}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-card-title"
        tabIndex={-1}
        style={{
          top: `${tooltip?.top ?? 0}px`,
          left: `${tooltip?.left ?? 0}px`,
          visibility: tooltip ? "visible" : "hidden",
        }}
      >
        <p className="tour__progress tabular-nums">
          {messages.tour.progress(stepNumber(index), steps.length)}
        </p>
        <h2 id="tour-card-title" className="tour__title">
          {text.title}
        </h2>
        <p className="tour__body">{text.body}</p>
        <div className="tour__actions">
          <button type="button" className="tour__skip" onClick={() => close(true)}>
            {messages.tour.skip}
          </button>
          <div className="tour__nav">
            <button type="button" className="tour__prev" onClick={() => move(-1)} disabled={index === 0}>
              {messages.tour.prev}
            </button>
            <button type="button" className="tour__next" onClick={() => move(1)}>
              {isLast ? messages.tour.finish : messages.tour.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
