/**
 * KIZAMI 公開打刻API(docs/external-api/index.md)を叩く薄いHTTPクライアント。
 *
 * 認証は `Authorization: Bearer <KIZAMI_API_KEY>`。キーのスコープがそのままこのクライアント
 * (延いては MCP ツール)の権限になる — punch スコープのキーなら打刻の作成・参照のみ、
 * read スコープなら参照のみ、というのはサーバー側(apps/api/src/auth/api-key-scope-guard.ts)
 * が強制する。このクライアント自身はスコープを判定・偽装しない(APIの応答をそのまま伝える)。
 *
 * エラーは HTTP ステータス/エラーコードのまま投げず、KizamiApiError に人間可読なメッセージへ
 * 変換して詰め替える(依頼: 「エラーを人間に分かるメッセージに変換する」)。
 */

import type {
  AttendanceState,
  CorrectionRequestDto,
  LeaveBalanceDto,
  MonthlySummaryDto,
  PunchDto,
  PunchKind,
  StatusDto,
} from "./types.js";

export interface KizamiClientOptions {
  /** KIZAMI API のベースURL(例: "http://localhost:3091")。末尾の "/" は有無どちらでもよい */
  baseUrl: string;
  /** `kzm_` から始まる公開打刻APIキー */
  apiKey: string;
  /** テスト用の fetch 差し替え。省略時はグローバル fetch */
  fetchImpl?: typeof fetch;
}

/**
 * KIZAMI API から返るエラーを人間可読なメッセージへ変換したもの。
 * `status` / `code` は元情報を保持する(呼び出し側が必要ならさらに分岐できるように)。
 */
export class KizamiApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "KizamiApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * apps/api が返す `{ error: "<code>" }` のうち、MCP 利用者にとって特に紛らわしい/重要なものを
 * 具体的な日本語メッセージに変換する対応表。ここに無いコードは status ベースの汎用メッセージ
 * (messageFor 内)にフォールバックする。
 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  unauthorized:
    "APIキーが無効か失効しています。KIZAMI にログインし「設定 > APIキー」で有効なキーを再発行のうえ、環境変数 KIZAMI_API_KEY を更新してください。",
  insufficient_api_key_scope:
    "このAPIキーにはこの操作を行う権限(スコープ)がありません。打刻には punch スコープ、参照には punch または read スコープが必要です。「設定 > APIキー」で必要なスコープを持つキーを発行し直してください。",
  forbidden: "この操作を行う権限がありません。",
  month_closed:
    "対象の月は既に締め処理済みのため、この操作はできません。記録を直す必要がある場合は、KIZAMI の画面から修正申請を行ってください(MCPからは修正申請を作成できません)。",
  month_closed_requires_unlock:
    "対象の月は既に締め処理済みで、この変更の反映には締めの解除権限が必要です。管理者にご相談ください。",
  invalid_kind: "打刻の種類が不正です。clock_in / clock_out / break_start / break_end のいずれかを指定してください。",
  invalid_occurred_at: "打刻時刻の指定が不正です。",
  occurred_at_in_future: "指定された打刻時刻が未来すぎます(サーバー時刻から数分以上先は指定できません)。",
  invalid_range: "参照期間の指定が不正です。",
  invalid_month: "月の指定が不正です。YYYY-MM 形式(例: 2026-08)で指定してください。",
  invalid_status: "ステータスの指定が不正です。",
  not_found: "対象のデータが見つかりませんでした。",
};

function extractErrorCode(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "error" in body) {
    const value = (body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function messageFor(status: number, code: string | undefined): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  if (status === 401) return ERROR_MESSAGES.unauthorized as string;
  if (status === 403) return ERROR_MESSAGES.forbidden as string;
  if (code) return `KIZAMI API がエラーを返しました: ${code}(HTTP ${status})`;
  return `KIZAMI API がエラーを返しました(HTTP ${status})`;
}

type QueryValue = string | number | undefined;

export class KizamiApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KizamiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, QueryValue>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const hasBody = opts.body !== undefined;
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (err) {
      // fetch 自体が失敗(接続不可・DNS不達など)。KIZAMI サーバーが未起動/URL誤りが典型的な原因
      const detail = err instanceof Error ? err.message : String(err);
      throw new KizamiApiError(
        `KIZAMI API(${this.baseUrl})に接続できませんでした。KIZAMI_API_URL の値とAPIサーバーが起動しているかを確認してください。(詳細: ${detail})`,
        0,
      );
    }

    const text = await res.text();
    let json: unknown;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!res.ok) {
      const code = extractErrorCode(json);
      throw new KizamiApiError(messageFor(res.status, code), res.status, code);
    }

    return json as T;
  }

  /** POST /punches。打刻を実際に作成する(取り消すには KIZAMI 側で修正申請が必要)。 */
  async punch(input: { kind: PunchKind; occurredAt?: number }): Promise<PunchDto> {
    const body: { kind: PunchKind; occurredAt?: number } =
      input.occurredAt === undefined ? { kind: input.kind } : { kind: input.kind, occurredAt: input.occurredAt };
    const result = await this.request<{ punch: PunchDto }>("POST", "/punches", { body });
    return result.punch;
  }

  /** GET /punches?from=&to=(UTC エポック分) */
  async listPunches(input: { from: number; to: number }): Promise<PunchDto[]> {
    const result = await this.request<{ punches: PunchDto[] }>("GET", "/punches", {
      query: { from: input.from, to: input.to },
    });
    return result.punches;
  }

  /** GET /attendance/status */
  async getStatus(): Promise<StatusDto> {
    return this.request<StatusDto>("GET", "/attendance/status");
  }

  /** GET /attendance/monthly?month=YYYY-MM(省略時サーバーが当月を使う) */
  async getMonthlySummary(input: { month?: string | undefined } = {}): Promise<MonthlySummaryDto> {
    return this.request<MonthlySummaryDto>("GET", "/attendance/monthly", {
      query: { month: input.month },
    });
  }

  /** GET /leave/balance */
  async getLeaveBalance(): Promise<LeaveBalanceDto> {
    return this.request<LeaveBalanceDto>("GET", "/leave/balance");
  }

  /** GET /corrections?status=pending|all(参照のみ。作成・承認・却下・取下げはMCPでは提供しない) */
  async listCorrections(input: { status?: "pending" | "all" | undefined } = {}): Promise<CorrectionRequestDto[]> {
    const result = await this.request<{ requests: CorrectionRequestDto[] }>("GET", "/corrections", {
      query: { status: input.status },
    });
    return result.requests;
  }
}

export type { AttendanceState };
