/**
 * apps/api への薄い fetch クライアント(Node 用、スクリーンショットのデータ投入専用)。
 *
 * apps/web/src/lib/api.ts と同じ契約(エンドポイント・ボディ形状)を、ブラウザではなく
 * Node のシードスクリプトから叩くための最小限の再実装。Cookie ストアを持たない Node の
 * fetch では `credentials:"include"` が効かないため、ログイン時に Set-Cookie を自分で
 * 保持して毎回 Cookie ヘッダに付け直す。
 */

export class ApiClient {
  private cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // 先頭の "name=value" 部分だけを保持する(Path/HttpOnly 等の属性は送り返す必要が無い)。
      this.cookie = setCookie.split(";")[0] ?? null;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** ログイン成功後の Cookie を、その後のすべてのリクエストへブラウザに代わって付与する。 */
  async login(email: string, password: string): Promise<{ user: { id: string; email: string; tenantId?: string } }> {
    return this.request("POST", "/auth/login", { email, password });
  }

  /** Playwright のブラウザコンテキストへそのまま渡せる形でセッション Cookie を取り出す。 */
  getSessionCookie(): string {
    if (!this.cookie) throw new Error("not logged in yet");
    return this.cookie;
  }

  punch(kind: string, occurredAt: number): Promise<{ punch: { id: string; kind: string; occurredAt: number } }> {
    return this.request("POST", "/punches", { kind, occurredAt });
  }

  listPunches(from: number, to: number): Promise<{ punches: Array<{ id: string; kind: string; occurredAt: number }> }> {
    return this.request("GET", `/punches?from=${from}&to=${to}`);
  }

  createCorrection(input: {
    targetEventId?: string;
    proposedKind?: string;
    proposedOccurredAt?: number;
    reason: string;
  }): Promise<{ request: { id: string }; targetMonthClosed: boolean }> {
    return this.request("POST", "/corrections", input);
  }

  approveCorrection(id: string, note?: string): Promise<{ request: { id: string } }> {
    return this.request("POST", `/corrections/${id}/approve`, note ? { note } : {});
  }

  listDepartments(): Promise<{ departments: Array<{ id: string; name: string; parentId: string | null }> }> {
    return this.request("GET", "/departments");
  }

  createDepartment(name: string, parentId?: string): Promise<{ department: { id: string; name: string } }> {
    return this.request("POST", "/departments", parentId ? { name, parentId } : { name });
  }

  updateMember(id: string, input: { departmentId?: string; hireDate?: string | null }): Promise<unknown> {
    return this.request("PATCH", `/members/${id}`, input);
  }

  listPresets(): Promise<{ presets: Array<{ id: string; name: string; isSystem: boolean }> }> {
    return this.request("GET", "/presets");
  }

  createPreset(input: {
    name: string;
    description?: string;
    grants: Array<{ key: string; scope: string }>;
  }): Promise<{ preset: { id: string; name: string } }> {
    return this.request("POST", "/presets", input);
  }

  assignMemberPresets(id: string, presetIds: string[]): Promise<unknown> {
    return this.request("PUT", `/members/${id}/presets`, { presetIds });
  }

  closeMonth(period: string, note?: string): Promise<unknown> {
    return this.request("POST", `/closings/${period}/close`, note ? { note } : {});
  }

  updateLeaveSettings(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/leave", input);
  }

  autoGrantLeave(userId: string): Promise<{ created: Array<{ id: string; leaveType: string; days: number; expiresOn: string }>; skipped: number }> {
    return this.request("POST", "/leave/grants/auto", { userId });
  }

  convertExpiredLeave(userId: string): Promise<unknown> {
    return this.request("POST", "/leave/grants/convert-expired", { userId });
  }

  createLeaveRequest(input: {
    leaveDate: string;
    unit?: string;
    minutes?: number;
    leaveType?: string;
    reason: string;
  }): Promise<{ request: { id: string } }> {
    return this.request("POST", "/leave/requests", input);
  }

  approveLeaveRequest(id: string, note?: string): Promise<unknown> {
    return this.request("POST", `/leave/requests/${id}/approve`, note ? { note } : {});
  }

  updateNotificationSettings(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/notifications", input);
  }

  updatePersonalNotificationSettings(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/notifications/me", input);
  }

  updateSlackSettings(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/slack", input);
  }

  updateTenantProfile(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/tenant-profile", input);
  }

  createAttendanceSettingVersion(input: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/settings/attendance", input);
  }

  createWorkPolicyVersion(input: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/settings/work-policy", input);
  }

  /** パスワードリセット発行(Tier 0)。passwordReset.token は平文で、この1度しか取得できない。 */
  issuePasswordReset(memberId: string): Promise<{ passwordReset: { token: string } }> {
    return this.request("POST", `/members/${memberId}/password-resets`);
  }

  /** 招待付きメンバー作成(v0.5)。invitation.token は平文で、この1度しか取得できない。 */
  createMemberWithInvitation(input: Record<string, unknown>): Promise<{ member: { id: string }; invitation: { token: string } }> {
    return this.request("POST", "/members", input);
  }

  updatePrivacyContact(input: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", "/settings/privacy-contact", input);
  }

  updateWorkRulesUrl(url: string): Promise<unknown> {
    return this.request("PUT", "/settings/work-rules-url", { url });
  }

  createApiKey(input: { name: string; scopes: string[]; expiresAt?: number | null }): Promise<{ apiKey: { id: string; token: string } }> {
    return this.request("POST", "/api-keys", input);
  }

  /**
   * POST /auto-break-waivers(休憩自動控除の打ち消し申請、2026-08-23 追加)。
   * 本人分のみ作成できる(targetUserId 指定は無い)。
   */
  createAutoBreakWaiver(input: {
    waiveDate: string;
    reason: string;
  }): Promise<{ waiver: { id: string; status: string; waiveDate: string; reason: string }; targetMonthClosed: boolean }> {
    return this.request("POST", "/auto-break-waivers", input);
  }
}
