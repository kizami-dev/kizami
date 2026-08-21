/**
 * 固定原則(docs/requirements.md §4): 自分の打刻・自分の申請の起票・自分の記録閲覧の
 * セルフサービス権限は、プリセットのON/OFFに関わらず全ユーザーが常時保持する。
 *
 * docs/design/permission-catalog.md 前提にも明記の通り「プリセットのON/OFF対象外のため
 * 本カタログには含めない」権限であり、業務タスク権限カタログ(30項目)には含まれない。
 * ここではカタログに存在しない専用キーとして定義する(判断点: カタログに定義がないため
 * 実装側でキー名を新規に定めた)。
 */

import type { Grant, PermissionKey } from "./types.js";

export const SELF_SERVICE_PERMISSIONS = {
  /** 自分自身の打刻(出退勤・休憩)を記録できる */
  punch: "self_service.punch" as PermissionKey,
  /** 自分自身の修正申請・休暇申請を起票できる */
  requestOwn: "self_service.request" as PermissionKey,
  /** 自分自身の勤怠記録を閲覧できる */
  viewOwnRecord: "self_service.record.view" as PermissionKey,
} as const;

/** 常時付与される固定grant(全て scope: "self")。resolveEffectiveGrants が自動的に合算する。 */
export const SELF_SERVICE_GRANTS: readonly Grant[] = [
  { permission: SELF_SERVICE_PERMISSIONS.punch, scope: "self" },
  { permission: SELF_SERVICE_PERMISSIONS.requestOwn, scope: "self" },
  { permission: SELF_SERVICE_PERMISSIONS.viewOwnRecord, scope: "self" },
];
