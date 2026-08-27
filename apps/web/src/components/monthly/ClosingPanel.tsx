"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "waku";
import {
  api,
  ApiError,
  UnauthorizedError,
  type ClosingEventDto,
  type ClosingStateDto,
  type MonthlyAttendance,
} from "../../lib/api";
import { mapClosingErrorMessage, messages } from "../../lib/messages";
import { formatDateTimeJst } from "../../lib/time";
import { ConfirmDialog } from "../ConfirmDialog";
import { HelpTip } from "../HelpTip";

export interface ClosingPanelProps {
  monthParam: string;
  /** 締め/解除・打刻修正等の反映トリガ(useMonthlyData の reloadKey)。 */
  reloadKey: number;
  /** 締め/解除に成功した際、月次本体の再取得を呼び出し元に依頼する。 */
  onReload: () => void;
  /** closingActorLabel の自分判定に使う。 */
  userId: string | undefined;
  /**
   * 月次本体データ。パネルの表示条件(元実装の data ? (…) : null)を再現するためだけに使う
   * — null の間(月次データ未取得)は締め状態取得 effect は動いても何も描画しない。
   */
  data: MonthlyAttendance | null;
}

/**
 * 月次締め状態(締め済み/修正バッジ・締め/解除操作・履歴)。MonthlyView から状態・ハンドラ・
 * 履歴・ConfirmDialog×2 を切り出したもの(挙動不変、第3波分割)。
 *
 * 締め状態の取得 effect は data(月次集計)の到着を待たずに動く(元実装どおり、締めパネルは
 * 月次本体と並行して取得する独立情報のため)。
 */
export function ClosingPanel({ monthParam, reloadKey, onReload, userId, data }: ClosingPanelProps) {
  const router = useRouter();

  // 締め状態(v0.3): GET /closings/:period が 403 ならパネル自体を非表示にする(依頼どおり)。
  const [closingState, setClosingState] = useState<ClosingStateDto | null>(null);
  const [closingForbidden, setClosingForbidden] = useState(false);

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [reopenPending, setReopenPending] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getClosingState(monthParam)
      .then((res) => {
        setClosingState(res.closing);
        setClosingForbidden(false);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setClosingForbidden(true);
          setClosingState(null);
          return;
        }
        // 締めパネルは付加情報のため、それ以外のエラーは静かに諦める(本体の月次表示は継続する)
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthParam, reloadKey]);

  async function handleCloseConfirm() {
    setClosePending(true);
    setCloseError(null);
    try {
      const res = await api.closeMonth(monthParam, closeNote.trim() === "" ? undefined : closeNote.trim());
      setClosingState(res.closing);
      setCloseConfirmOpen(false);
      setCloseNote("");
      onReload();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setCloseError(err instanceof ApiError ? mapClosingErrorMessage(err.body) : messages.errors.network);
    } finally {
      setClosePending(false);
    }
  }

  async function handleReopenConfirm() {
    setReopenPending(true);
    setReopenError(null);
    try {
      const res = await api.reopenMonth(monthParam, reopenNote.trim() === "" ? undefined : reopenNote.trim());
      setClosingState(res.closing);
      setReopenConfirmOpen(false);
      setReopenNote("");
      onReload();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        router.push("/login");
        return;
      }
      setReopenError(err instanceof ApiError ? mapClosingErrorMessage(err.body) : messages.errors.network);
    } finally {
      setReopenPending(false);
    }
  }

  function closingActorLabel(event: ClosingEventDto): string {
    return event.actorId === userId ? messages.closing.historyActorSelf : event.actorId;
  }

  // 締めパネル(操作・履歴)は月次本体データの到着を待って出す(元実装で data ? (…) : null の
  // 内側にあったのと同じ表示条件)。効果(締め状態の取得 effect)自体は data を待たず動く。
  if (!data) return null;

  return (
    <>
      {!closingForbidden && closingState ? (
        <div className="closing-panel" data-tour="monthly-closing">
          <div className="closing-panel__actions">
            {closingState.status === "open" ? (
              <>
                <button
                  type="button"
                  className="k-modal__confirm k-modal__confirm--neutral"
                  onClick={() => setCloseConfirmOpen(true)}
                >
                  {messages.closing.closeAction}
                </button>
                <HelpTip helpKey="closing.execute" />
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="k-modal__confirm k-modal__confirm--caution"
                  onClick={() => setReopenConfirmOpen(true)}
                >
                  {messages.closing.reopenAction}
                </button>
                <HelpTip helpKey="closing.unlock" />
              </>
            )}
          </div>

          <details className="closing-history">
            <summary>{messages.closing.historyTitle}</summary>
            {closingState.history.length === 0 ? (
              <p className="closing-history__empty">{messages.closing.historyEmpty}</p>
            ) : (
              <ul className="closing-history__list">
                {[...closingState.history].reverse().map((event) => (
                  <li key={event.id} className={`closing-history__item closing-history__item--${event.event}`}>
                    <span className="closing-history__event">{messages.closing.historyEventLabel[event.event]}</span>
                    <span className="closing-history__actor">{closingActorLabel(event)}</span>
                    <span className="closing-history__time tabular-nums">{formatDateTimeJst(event.occurredAt)}</span>
                    {event.note ? <span className="closing-history__note">{event.note}</span> : null}
                    {event.correctionRequestId ? (
                      <Link to="/corrections" className="closing-history__link">
                        {messages.closing.historyCorrectionLink}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      ) : null}

      {closeConfirmOpen ? (
        <ConfirmDialog
          title={messages.closing.confirmCloseTitle}
          message={messages.closing.confirmCloseMessage}
          confirmLabel={messages.closing.confirmCloseLabel}
          tone="neutral"
          note={closeNote}
          onNoteChange={setCloseNote}
          noteLabel={messages.closing.noteLabel}
          notePlaceholder={messages.closing.notePlaceholder}
          pending={closePending}
          error={closeError}
          onConfirm={handleCloseConfirm}
          onCancel={() => {
            setCloseConfirmOpen(false);
            setCloseError(null);
          }}
        />
      ) : null}

      {reopenConfirmOpen ? (
        <ConfirmDialog
          title={messages.closing.confirmReopenTitle}
          message={messages.closing.confirmReopenMessage}
          extraNote={messages.closing.confirmReopenExtraNote}
          confirmLabel={messages.closing.confirmReopenLabel}
          tone="caution"
          note={reopenNote}
          onNoteChange={setReopenNote}
          noteLabel={messages.closing.noteLabel}
          notePlaceholder={messages.closing.notePlaceholder}
          pending={reopenPending}
          error={reopenError}
          onConfirm={handleReopenConfirm}
          onCancel={() => {
            setReopenConfirmOpen(false);
            setReopenError(null);
          }}
        />
      ) : null}
    </>
  );
}
