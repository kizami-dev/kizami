"use client";

import { useEffect, useState } from "react";
import { api, type AttendanceMemberDto, type DepartmentDto } from "../../lib/api";
import { messages } from "../../lib/messages";

export interface MemberSwitcherProps {
  selfId: string;
  targetUserId: string;
  onChange: (userId: string) => void;
}

interface Group {
  /** null = 未所属(部署なし)グループ。 */
  departmentId: string | null;
  label: string;
  members: AttendanceMemberDto[];
}

/**
 * 部署名でグループ化する(依頼「部署でグループ化できれば尚良」)。部署名の解決には
 * GET /departments を使うが、これは department.manage または member.view を要求するため
 * (lib/useSettingsAccess.ts のコメント参照)、attendance.record.view しか持たない閲覧者では
 * 403 になりうる。取得できなければ部署IDをそのままラベルにするのではなく、
 * グループ化自体を諦めてフラットな1グループにフォールバックする(判断点: 存在しない部署名を
 * 見せるより、単純な一覧の方が誤解がない)。
 */
function buildGroups(members: AttendanceMemberDto[], departments: DepartmentDto[] | null, selfId: string): Group[] {
  const others = members.filter((m) => m.id !== selfId).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (!departments) {
    return others.length > 0 ? [{ departmentId: null, label: messages.monthly.memberSwitcherOthersGroup, members: others }] : [];
  }
  const nameById = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = new Map<string | null, AttendanceMemberDto[]>();
  for (const m of others) {
    const list = byDept.get(m.departmentId) ?? [];
    list.push(m);
    byDept.set(m.departmentId, list);
  }
  const groups: Group[] = [];
  for (const [departmentId, list] of byDept) {
    groups.push({
      departmentId,
      label: departmentId !== null ? (nameById.get(departmentId) ?? messages.monthly.memberSwitcherUnknownDepartment) : messages.monthly.memberSwitcherNoDepartment,
      members: list,
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return groups;
}

/**
 * 月次の閲覧対象切替(2026-08-23 新設、他人の勤怠閲覧)。メンバー一覧が自分だけなら
 * 何も描画しない(依頼: 自分のみの人には切替UIを出さない)。
 */
export function MemberSwitcher({ selfId, targetUserId, onChange }: MemberSwitcherProps) {
  const [members, setMembers] = useState<AttendanceMemberDto[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAttendanceMembers()
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    api
      .listDepartments()
      .then((res) => {
        if (!cancelled) setDepartments(res.departments);
      })
      .catch(() => {
        // 権限が無い/取得失敗: グループ化を諦めてフラット表示にフォールバックする(buildGroups 参照)。
        if (!cancelled) setDepartments(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!members || members.length <= 1) return null;

  const self = members.find((m) => m.id === selfId);
  const groups = buildGroups(members, departments, selfId);

  return (
    <div className="correction-field monthly-member-switcher">
      <label htmlFor="monthly-member-switcher-select">{messages.monthly.memberSwitcherLabel}</label>
      <select id="monthly-member-switcher-select" value={targetUserId} onChange={(e) => onChange(e.target.value)}>
        {self ? <option value={self.id}>{messages.monthly.memberSwitcherSelfOption(self.name)}</option> : null}
        {groups.map((g) => (
          <optgroup key={g.departmentId ?? "__none__"} label={g.label}>
            {g.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
