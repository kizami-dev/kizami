"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  downloadAttendanceCsv,
  probeAttendanceCsvAccess,
  UnauthorizedError,
  type MonthlyAttendance,
} from "../../lib/api";
import { messages } from "../../lib/messages";

export interface CsvExportProps {
  monthParam: string;
  /**
   * 月次本体データ。CSV ダウンロードの compareOriginal 判定(data?.amended)と、
   * パネルの表示条件(元実装の data ? (…) : null)の両方に使う。
   */
  data: MonthlyAttendance | null;
}

/**
 * CSVエクスポート(v0.3)。HEAD プローブで権限が無ければボタンごと出さない。
 * MonthlyView から状態・effect・ハンドラを切り出したもの(挙動不変、第3波分割)。
 *
 * プローブ effect は data(月次集計)の到着を待たずに動く(元実装どおり、reloadKey にも
 * 依存しない — 権限は月をまたいで変わらない想定のため)。
 */
export function CsvExport({ monthParam, data }: CsvExportProps) {
  const router = useRouter();

  const [csvAllowed, setCsvAllowed] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    probeAttendanceCsvAccess(monthParam).then((ok) => {
      if (!cancelled) setCsvAllowed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [monthParam]);

  async function handleCsvDownload() {
    setCsvDownloading(true);
    setCsvError(null);
    try {
      const { blob, filename } = await downloadAttendanceCsv(monthParam, data?.amended === true && compareOriginal);
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
      setCsvError(messages.closing.csvDownloadFailed);
    } finally {
      setCsvDownloading(false);
    }
  }

  // csv-export div は元実装で data ? (…) : null の内側にあったのと同じ表示条件を再現する。
  if (!data) return null;

  return csvAllowed ? (
    <div className="csv-export">
      {data.amended ? (
        <label className="csv-export__checkbox">
          <input type="checkbox" checked={compareOriginal} onChange={(e) => setCompareOriginal(e.target.checked)} />
          {messages.closing.csvCompareOriginalLabel}
        </label>
      ) : null}
      <button type="button" className="k-modal__cancel" onClick={handleCsvDownload} disabled={csvDownloading}>
        {csvDownloading ? messages.closing.csvDownloading : messages.closing.csvDownload}
      </button>
      {csvError ? (
        <p className="correction-error" role="alert">
          {csvError}
        </p>
      ) : null}
    </div>
  ) : null;
}
