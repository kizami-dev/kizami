/**
 * 権限プリセット関連の純粋ロジック(部署・メンバー・権限プリセット管理UI共通)。
 *
 * 判断点: 実効権限の合算・スコープ順序は packages/authz(apps/api が使う権限エンジン)と
 * 同じ規則(自己昇格・自己降格判定も同じ規則に依拠)だが、apps/web には依存を追加せず
 * ここで最小限だけ再実装する(apps/web は今回のスコープ外である packages/* への
 * 依存追加を伴わずに完結させたいため。ロジックは1画面のプレビュー表示専用で、
 * サーバー側の判定を代替するものではない — 実際の許可判定は常に apps/api が行う)。
 */

import type { EffectivePermissionDto, PermissionCatalogEntryDto, PermissionGrantDto, PermissionPresetDto, Scope } from "./api";

const SCOPE_ORDER: Record<Scope, number> = {
  self: 0,
  department: 1,
  department_and_descendants: 2,
  tenant: 3,
};

export function scopeRank(scope: Scope): number {
  return SCOPE_ORDER[scope];
}

export function widerScope(a: Scope, b: Scope): Scope {
  return scopeRank(b) > scopeRank(a) ? b : a;
}

/**
 * GET /me/effective-permissions の結果に対し、key を minScope 以上のスコープで持っているかを
 * 判定する(apps/api/src/authz.ts の requirePermission と同じスコープ階層。2026-08-23 追加)。
 *
 * UI の出し分け(ナビ・ボタンの表示可否)専用の参考判定であり、実際の許可判定は常に apps/api
 * (requirePermission)が行う。権限が無ければボタン自体を出さない用途で使う
 * (lib/useSettingsAccess.ts・CorrectionsView・LeaveRequestsList・MembersView)。
 */
export function hasEffectivePermission(
  permissions: readonly EffectivePermissionDto[],
  key: string,
  minScope: Scope,
): boolean {
  return permissions.some((p) => p.key === key && scopeRank(p.scope) >= scopeRank(minScope));
}

/**
 * カタログに存在しない「閲覧のみ含意される」内部キー(packages/authz/src/implied.ts 参照)。
 * 業務タスクカタログ(30項目)には対応キーが無いため、権限プリセット編集画面の
 * 「この権限には○○の閲覧が含まれます」表示のためだけにここで一覧を持つ(判断点)。
 *
 * ラベルの日本語ハードコードは messages(lib/i18n の permissions.internalViewLabel、4言語)へ
 * 移した(2026-08-23、i18n 対応)。ここではキーの一覧(=カタログ外キーの判定にも使う)だけを持つ。
 */
export const INTERNAL_VIEW_KEYS: readonly string[] = [
  "department.view",
  "tenant_settings.view",
  "permission_preset.view",
  "permission_assignment.effective_view",
  "api_key.view",
];

/**
 * カタログキーの接頭辞から業務グループへ機械的に分類する(依頼:
 * 「カタログのキーの接頭辞から機械的に分類してよい」)。
 * 表示順もこの配列順。グループ名の日本語ハードコードは messages(lib/i18n の
 * permissions.categoryLabel、4言語)へ移した(2026-08-23、i18n 対応)。
 */
export const PERMISSION_CATEGORIES: readonly { id: string; prefixes: readonly string[] }[] = [
  { id: "attendance", prefixes: ["attendance."] },
  { id: "leave", prefixes: ["leave."] },
  { id: "closing", prefixes: ["closing.", "export.", "alert."] },
  { id: "org", prefixes: ["member.", "department."] },
  { id: "settings", prefixes: ["tenant_settings.", "notification.", "permission.", "audit_log.", "api_key."] },
] as const;

/** カタログのどの接頭辞にも一致しない項目のグループ ID。messages.permissions.categoryLabel.other に対応する。 */
export const OTHER_CATEGORY_ID = "other";

export function categoryForKey(key: string): { id: string } {
  for (const cat of PERMISSION_CATEGORIES) {
    if (cat.prefixes.some((p) => key.startsWith(p))) return { id: cat.id };
  }
  return { id: OTHER_CATEGORY_ID };
}

/**
 * カタログ項目をグループ化して返す(表示順: PERMISSION_CATEGORIES の順、その他は末尾)。
 * グループの表示名は id をキーに呼び出し側で messages.permissions.categoryLabel[id] を引く
 * (このファイルは apps/web の他の lib と同じく、表示文言そのものは持たない)。
 */
export function groupCatalogByCategory(
  catalog: readonly PermissionCatalogEntryDto[],
): { id: string; entries: PermissionCatalogEntryDto[] }[] {
  const groups = new Map<string, { id: string; entries: PermissionCatalogEntryDto[] }>();
  for (const entry of catalog) {
    const cat = categoryForKey(entry.key);
    const g = groups.get(cat.id) ?? { id: cat.id, entries: [] };
    g.entries.push(entry);
    groups.set(cat.id, g);
  }
  const order = [...PERMISSION_CATEGORIES.map((c) => c.id), OTHER_CATEGORY_ID];
  return order.map((id) => groups.get(id)).filter((g): g is NonNullable<typeof g> => g !== undefined);
}

/**
 * GET /members が返す presetNames(名前のみ)を GET /presets の一覧と突き合わせて
 * presetId の配列へ変換する(判断点: apps/api の member.presetNames には presetId が
 * 含まれないため — apps/api は変更禁止 — 名前一致で復元する。同名プリセットが複数存在する
 * 場合は先頭から消費して割り当てるため、通常運用(名前重複なし)では正確に一致する)。
 */
export function matchAssignedPresetIds(presetNames: readonly string[], allPresets: readonly PermissionPresetDto[]): string[] {
  const remaining = [...allPresets];
  const result: string[] = [];
  for (const name of presetNames) {
    const idx = remaining.findIndex((p) => p.name === name);
    if (idx === -1) continue;
    const [matched] = remaining.splice(idx, 1);
    if (matched) result.push(matched.id);
  }
  return result;
}

export interface EffectivePermissionEntry {
  key: string;
  catalogEntry: PermissionCatalogEntryDto;
  scope: Scope;
  /** この権限を(直接、または閲覧含意の展開元として)与えているプリセット名。 */
  sourcePresetNames: string[];
  /** true: 直接チェックされた権限ではなく、他の権限の「操作は閲覧を含意」展開でのみ得ている。 */
  viaImplication: boolean;
  /**
   * true: どこかのプリセットが付与しているが、別の(または同じ)プリセットの拒否(deny)に
   * よって打ち消され、実際には**行使できない**(2026-08-24 追加)。
   *
   * 一覧から消さずに残すのは、「割り当てたプリセットに書いてある権限が画面から消えている」
   * 状態が管理者にとって最も分かりにくいため。打ち消されていることを取り消し線+「拒否」チップで
   * 明示する(EffectivePermissionsPanel)。付与元が1つも無い権限は元から一覧に出ないので、
   * このフラグが立つのは「付与と拒否が衝突している」ときだけになる。
   */
  denied: boolean;
  /** denied=true のとき、その拒否を持つプリセット名。 */
  deniedByPresetNames: string[];
}

/**
 * 選択中(または割当済み)のプリセット群から実効権限を計算する。
 * - 複数プリセットの合算(union)。同一キーは広い方のスコープを採用
 * - 「操作は閲覧を含意」をカタログの impliesView に沿って展開(不動点まで)
 * - **拒否(deny)の適用**。どれか1つのプリセットが拒否していれば、他のプリセットが付与していても
 *   行使できない(denied=true として一覧に残し、表示側で打ち消し線+チップにする)。
 *   packages/authz の評価器と同じく、拒否された権限は「操作は閲覧を含意」の展開元にもならない
 *   (拒否した操作の道連れで得ていた閲覧だけが残る、という中途半端な状態を作らない)
 * - カタログ(業務タスク)に対応キーが無い含意(内部専用の *.view)は業務タスク一覧には出さない
 *   (INTERNAL_VIEW_LABELS はプリセット編集画面の説明文でのみ使う)
 *
 * サーバー側(packages/authz)の判定を代替するものではない、という位置づけはこのファイル冒頭の
 * コメントのとおり(実際の許可判定は常に apps/api が行う)。
 */
export function computeEffectivePermissions(
  presets: readonly { name: string; grants: readonly PermissionGrantDto[]; denies?: readonly string[] }[],
  catalog: readonly PermissionCatalogEntryDto[],
): EffectivePermissionEntry[] {
  const catalogMap = new Map(catalog.map((e) => [e.key, e]));

  interface Acc {
    scope: Scope;
    sources: Set<string>;
    direct: boolean;
  }
  const combined = new Map<string, Acc>();

  // 拒否の合算(union)。キー -> それを拒否しているプリセット名。
  const deniedBy = new Map<string, Set<string>>();
  for (const preset of presets) {
    for (const key of preset.denies ?? []) {
      if (!catalogMap.has(key)) continue; // カタログ外キーの拒否は無視(セルフサービス権限は拒否できない)
      const names = deniedBy.get(key) ?? new Set<string>();
      names.add(preset.name);
      deniedBy.set(key, names);
    }
  }

  for (const preset of presets) {
    for (const grant of preset.grants) {
      if (!catalogMap.has(grant.key)) continue; // カタログ外キーは業務タスク一覧に出さない
      const cur = combined.get(grant.key);
      if (!cur) {
        combined.set(grant.key, { scope: grant.scope, sources: new Set([preset.name]), direct: true });
      } else {
        cur.sources.add(preset.name);
        if (scopeRank(grant.scope) > scopeRank(cur.scope)) cur.scope = grant.scope;
      }
    }
  }

  let changed = true;
  for (let pass = 0; changed && pass < 10; pass++) {
    changed = false;
    for (const [key, v] of Array.from(combined.entries())) {
      const catEntry = catalogMap.get(key);
      if (!catEntry) continue;
      // 拒否された権限は含意の展開元にならない(サーバー側 applyDenies の適用順と揃える)
      if (deniedBy.has(key)) continue;
      for (const impliedKey of catEntry.impliesView) {
        if (!catalogMap.has(impliedKey)) continue;
        const cur = combined.get(impliedKey);
        if (!cur) {
          combined.set(impliedKey, { scope: v.scope, sources: new Set(v.sources), direct: false });
          changed = true;
          continue;
        }
        if (scopeRank(v.scope) > scopeRank(cur.scope)) {
          cur.scope = v.scope;
          changed = true;
        }
        for (const s of v.sources) {
          if (!cur.sources.has(s)) {
            cur.sources.add(s);
            changed = true;
          }
        }
      }
    }
  }

  return Array.from(combined.entries())
    .map(([key, v]) => {
      const catalogEntry = catalogMap.get(key);
      if (!catalogEntry) return null;
      const denierNames = deniedBy.get(key);
      return {
        key,
        catalogEntry,
        scope: v.scope,
        sourcePresetNames: Array.from(v.sources).sort(),
        viaImplication: !v.direct,
        denied: denierNames !== undefined,
        deniedByPresetNames: denierNames ? Array.from(denierNames).sort() : [],
      };
    })
    .filter((e): e is EffectivePermissionEntry => e !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}
