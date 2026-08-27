"use client";

import { useEffect, useState } from "react";
import { useRouter } from "waku";
import {
  downloadAttendanceCsv,
  probeAttendanceCsvAccess,
  UnauthorizedError,
  type AttendanceCsvFormat,
  type MonthlyAttendance,
} from "../../lib/api";
import { messages } from "../../lib/messages";

/** セレクタに出す順序。既定(generic)を先頭に置く。 */
const CSV_FORMATS: readonly AttendanceCsvFormat[] = ["generic", "freee", "mf"];

export interface CsvExportProps {
  monthParam: string;
  /**
   * 月次本体データ。CSV ダウンロードの compareOriginal 判定(data?.closing.amended)と、
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
 *
 * 形式セレクタ(2026-08-27 追加): 汎用CSV(既定)に加えて freee人事労務 / マネーフォワード
 * クラウド給与向けの互換CSVを選べる。給与ソフト形式は**β(要マッピング確認)**であり、
 * 選択中は必ず注意書きを出す — 列名・単位・従業員の識別子が会社の設定と一致している保証が
 * 無く、そのまま取り込むと誤った賃金計算につながるため(docs/design/payroll-export.md)。
 */
export function CsvExport({ monthParam, data }: CsvExportProps) {
  const router = useRouter();

  const [csvAllowed, setCsvAllowed] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [format, setFormat] = useState<AttendanceCsvFormat>("generic");

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
      // compare=original は汎用CSV専用(給与ソフト形式は固定列しか受け付けないため API が 400 を返す)。
      // セレクタが generic 以外のときはチェックボックス自体を出さないが、状態は残りうるのでここでも落とす。
      const withCompare = format === "generic" && data?.closing.amended === true && compareOriginal;
      const { blob, filename } = await downloadAttendanceCsv(monthParam, withCompare, format);
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
      <label className="csv-export__format">
        {messages.closing.csvFormatLabel}
        <select value={format} onChange={(e) => setFormat(e.target.value as AttendanceCsvFormat)}>
          {CSV_FORMATS.map((f) => (
            <option key={f} value={f}>
              {messages.closing.csvFormatOptions[f]}
            </option>
          ))}
        </select>
      </label>
      {/* compare=original は汎用CSV専用。給与ソフト形式では列を足せないためチェックボックスごと隠す。 */}
      {data.closing.amended && format === "generic" ? (
        <label className="csv-export__checkbox">
          <input type="checkbox" checked={compareOriginal} onChange={(e) => setCompareOriginal(e.target.checked)} />
          {messages.closing.csvCompareOriginalLabel}
        </label>
      ) : null}
      <button type="button" className="k-modal__cancel" onClick={handleCsvDownload} disabled={csvDownloading}>
        {csvDownloading ? messages.closing.csvDownloading : messages.closing.csvDownload}
      </button>
      {/*
        給与ソフト形式は「各社テンプレートに合わせた互換CSV(β)」であって公式フォーマットの
        保証が無い(docs/design/payroll-export.md)。賃金計算を誤らせないため、選択中は必ず
        注意書きを出す(依頼: 断定できないなら β・要検証ラベル)。
      */}
      {format === "generic" ? null : (
        <p className="csv-export__beta" role="note">
          {messages.closing.csvFormatBetaNote}
        </p>
      )}
      {csvError ? (
        <p className="correction-error" role="alert">
          {csvError}
        </p>
      ) : null}
    </div>
  ) : null;
}
