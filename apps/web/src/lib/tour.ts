/**
 * 初回ログイン時の「使い方ツアー」の純粋ロジック(2026-08-27 追加、
 * docs/requirements.md §11「以降」のオンボーディングツアー)。
 *
 * 方針(判断点):
 * - **UI から切り離した純関数だけ**をここに置く。手順の定義・監査対象の絞り込み・
 *   進む/戻るの状態遷移・保存/復元のガード・ツールチップの配置計算がすべてここに集まるため、
 *   DOM(jsdom)を用意しなくてもテストできる(要素の有無・画面サイズは「入力」として渡す)。
 *   描画側(components/Tour.tsx)は、ここが返した値をそのまま置くだけにする。
 * - **サーバーには保存しない**。ツアーの完了/スキップは「この端末でもう一度見せるか」だけの
 *   都合であり、業務データではない。マイグレーションを増やしてまで永続化する価値がないと判断した
 *   (別の端末で初めて開いたときにもう一度出るのは、むしろ望ましい)。localStorage が使えない
 *   環境(プライベートブラウズ等)でも壊れないよう、読み書きはすべて try/catch で握りつぶす
 *   — 最悪でも「毎回ツアーが出る/出ない」だけで、業務は止まらない。
 * - 手順は既存画面の要素を `data-tour="<target>"` で指すだけにし、ツアーのために画面の構造は
 *   変えない。権限で消える要素(メンバー招待ボタン等)を指した手順は、実行時に要素が
 *   見つからなければ黙って飛ばす(skipMissing の考え方 — components/Tour.tsx の待機ループ参照)。
 */
import type { Unstable_RouteHref as RouteHref } from "waku/router/client";

/**
 * 手順の識別子。i18n の `messages.tour.steps[<id>]`(4言語)のキーと1対1で対応させる
 * (型でキーの過不足が検出される — CONTRIBUTING.md「UI 文言は4言語すべてに追加」)。
 */
export type TourStepId =
  | "dashboard"
  | "punch"
  | "monthly"
  | "corrections"
  | "leave"
  | "notifPrefs"
  | "settingsHub"
  | "members"
  | "attendance"
  | "closing";

/**
 * 手順を見せる相手。"member" は全員、"admin" は会社の設定を触れる人(member.invite 保持者)だけ。
 * 「管理者向けツアー = メンバー向けツアー + 管理者向けの手順」という積み上げにしてあり、
 * 管理者にも打刻・月次・申請の説明は必要なため、別立てのツアーにはしない。
 */
export type TourAudience = "member" | "admin";

export interface TourStep {
  readonly id: TourStepId;
  /** この手順を見せるページ。現在地と違えばツアー側が遷移する。 */
  readonly path: RouteHref;
  /** ハイライト対象を指す `data-tour` 属性の値。 */
  readonly target: string;
  /** "admin" ならその権限を持つ人にだけ見せる。 */
  readonly audience: TourAudience;
  /** ツールチップの既定の向き(画面外にはみ出す場合は placeTooltip が反転させる)。 */
  readonly placement: "top" | "bottom";
}

/**
 * 手順の並び。前半6つがメンバー向け(打刻 → 月次 → 申請 → 通知設定)、
 * 後半4つが管理者向け(設定ハブ → メンバー招待 → 勤怠ルール → 締め)。
 * 締めを最後に置いているのは、月次画面へ戻ってツアーを終えると「毎月の流れ」の順に
 * ひととおり見た形になるため。
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "dashboard", path: "/", target: "dashboard-todo", audience: "member", placement: "bottom" },
  { id: "punch", path: "/", target: "punch-pad", audience: "member", placement: "bottom" },
  { id: "monthly", path: "/monthly", target: "monthly-totals", audience: "member", placement: "bottom" },
  { id: "corrections", path: "/corrections", target: "corrections-own", audience: "member", placement: "bottom" },
  { id: "leave", path: "/leave", target: "leave-request-form", audience: "member", placement: "top" },
  { id: "notifPrefs", path: "/settings/notifications/me", target: "personal-notifications", audience: "member", placement: "bottom" },
  { id: "settingsHub", path: "/settings", target: "settings-hub-tenant", audience: "admin", placement: "bottom" },
  { id: "members", path: "/settings/members", target: "member-invite", audience: "admin", placement: "bottom" },
  { id: "attendance", path: "/settings/attendance", target: "attendance-rules", audience: "admin", placement: "bottom" },
  { id: "closing", path: "/monthly", target: "monthly-closing", audience: "admin", placement: "top" },
];

/** ツアーを走らせないページ(未ログインで見る画面)。ここでは自動開始も再開もしない。 */
const NON_TOUR_PATH_PREFIXES: readonly string[] = ["/login", "/invite/", "/reset/"];

/** そのパスでツアーを動かしてよいか(ログイン前の画面では常に false)。 */
export function isTourablePath(path: string): boolean {
  return !NON_TOUR_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/** 相手に応じた手順の並びを返す(メンバーには管理者向けの手順を渡さない)。 */
export function stepsFor(audience: TourAudience, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((step) => step.audience === "member" || audience === "admin");
}

/**
 * 実効権限から相手を決める。会社の設定に手が届く代表として member.invite を使う
 * (同梱プリセットでは「管理者」だけが持ち、マネージャー/メンバーは持たない)。
 * 判定そのものは呼び出し側(lib/permissions.ts の hasEffectivePermission)に任せ、
 * ここは真偽値を受けるだけにして純粋に保つ。
 */
export function audienceFor(canInviteMembers: boolean): TourAudience {
  return canInviteMembers ? "admin" : "member";
}

// ---- 保存(この端末だけ。サーバーには送らない — 冒頭の判断点参照) ----

export const TOUR_DONE_KEY = "kizami.tour.v1.done";
export const TOUR_PROGRESS_KEY = "kizami.tour.v1.step";

/** localStorage / sessionStorage の必要最小限の形。テストではダミーを渡す。 */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 完了(またはスキップ)済みか。ストレージが無い・例外を投げる(プライベートブラウズ、
 * Cookie/ストレージ禁止設定)場合は false = 「まだ見ていない」扱いにする。
 * 安全側は「出す」ではなく「出さない」ようにも見えるが、ここで true にすると保存できない
 * 環境ではツアーに一切辿り着けなくなるため、出す側に倒している(閉じれば消える)。
 */
export function readTourDone(storage: TourStorage | null | undefined): boolean {
  try {
    return storage?.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 完了/スキップの記録。false を渡すと記録を消す(「もう一度見る」から呼ぶ)。 */
export function writeTourDone(storage: TourStorage | null | undefined, done: boolean): void {
  try {
    if (done) storage?.setItem(TOUR_DONE_KEY, "1");
    else storage?.removeItem(TOUR_DONE_KEY);
  } catch {
    // 保存できなくてもツアー自体は最後まで動く(次回また出るだけ)。
  }
}

/**
 * 途中まで進んだ手順の復元。ツアーはページを跨いで進むため、遷移のたびに
 * コンポーネントが作り直されても続きから再開できるようにする(保存先は sessionStorage を想定)。
 * 保存済みの値が現在の手順一覧に無い(権限が変わった・手順を消した)場合は null を返す。
 */
export function readTourProgress(storage: TourStorage | null | undefined, steps: readonly TourStep[]): number | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(TOUR_PROGRESS_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const index = steps.findIndex((step) => step.id === raw);
  return index === -1 ? null : index;
}

/** 現在の手順を保存する。null を渡すと記録を消す(ツアー終了時)。 */
export function writeTourProgress(storage: TourStorage | null | undefined, step: TourStep | null): void {
  try {
    if (step) storage?.setItem(TOUR_PROGRESS_KEY, step.id);
    else storage?.removeItem(TOUR_PROGRESS_KEY);
  } catch {
    // 保存できない場合、ページを跨ぐ手順で先頭に戻ってしまうが、ツアー自体は成立する。
  }
}

// ---- 進む/戻る/終わりの状態遷移 ----

export type TourMove = "next" | "prev" | "skip";

/** キーボード操作の割り当て(Esc=スキップ、←→=戻る/進む)。対象外のキーは null。 */
export function keyToMove(key: string): TourMove | null {
  if (key === "Escape") return "skip";
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  return null;
}

/**
 * 次に表示する手順の位置。最後の手順から進むと null(=ツアー終了)。
 * 最初の手順から戻ろうとしても 0 に留まる(戻る操作でツアーを閉じない)。
 */
export function moveIndex(index: number, total: number, direction: 1 | -1): number | null {
  if (direction === 1) {
    const next = index + 1;
    return next >= total ? null : next;
  }
  return Math.max(0, index - 1);
}

/** 進捗表示(「3 / 10」)のための1始まりの番号。 */
export function stepNumber(index: number): number {
  return index + 1;
}

// ---- 位置計算(ハイライトの切り抜き・ツールチップの配置) ----

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface TooltipPosition {
  top: number;
  left: number;
  /** 実際に採用された向き(はみ出しで反転した結果)。 */
  placement: "top" | "bottom";
}

/** ハイライトの切り抜き(対象の周りに余白を足し、画面内に収める)。 */
export function cutoutRect(target: Rect, viewport: Size, padding = 8): Rect {
  const left = Math.max(0, target.left - padding);
  const top = Math.max(0, target.top - padding);
  const right = Math.min(viewport.width, target.left + target.width + padding);
  const bottom = Math.min(viewport.height, target.top + target.height + padding);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * ツールチップの配置。既定の向きに置けなければ反転し、それでも入らなければ
 * 画面内に収まる位置へ寄せる(スマホの狭い画面で吹き出しが切れないようにする)。
 * 横位置は対象の中央揃えを基本に、左右の余白 `margin` を切らないよう丸める。
 */
export function placeTooltip(
  target: Rect,
  tooltip: Size,
  viewport: Size,
  preferred: "top" | "bottom",
  gap = 12,
  margin = 12,
): TooltipPosition {
  const spaceBelow = viewport.height - (target.top + target.height);
  const spaceAbove = target.top;
  const needed = tooltip.height + gap + margin;

  let placement = preferred;
  if (placement === "bottom" && spaceBelow < needed && spaceAbove >= needed) placement = "top";
  else if (placement === "top" && spaceAbove < needed && spaceBelow >= needed) placement = "bottom";

  const rawTop = placement === "bottom" ? target.top + target.height + gap : target.top - tooltip.height - gap;
  const maxTop = Math.max(margin, viewport.height - tooltip.height - margin);
  const top = Math.min(Math.max(margin, rawTop), maxTop);

  const rawLeft = target.left + target.width / 2 - tooltip.width / 2;
  const maxLeft = Math.max(margin, viewport.width - tooltip.width - margin);
  const left = Math.min(Math.max(margin, rawLeft), maxLeft);

  return { top, left, placement };
}

/**
 * 対象が「ほとんど見えていない」ならスクロールして見せる必要がある。
 *
 * 「上端も下端も画面内にあること」を条件にしないのは、画面より背の高い対象
 * (要対応カードや設定フォーム)では絶対に満たせず、スクロールし続けてしまうため。
 * 見えている高さが「対象の6割」か「画面の4割」の小さいほうを超えていれば十分とする。
 */
export function needsScrollIntoView(target: Rect, viewport: Size, margin = 24): boolean {
  const visibleTop = Math.max(target.top, margin);
  const visibleBottom = Math.min(target.top + target.height, viewport.height - margin);
  const visible = visibleBottom - visibleTop;
  const enough = Math.min(target.height * 0.6, viewport.height * 0.4);
  return visible < enough;
}
