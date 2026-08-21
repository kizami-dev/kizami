/**
 * 権限プリセット関連の純粋ロジック(部署・メンバー・権限プリセット管理UI共通)。
 *
 * 判断点: 実効権限の合算・スコープ順序は packages/authz(apps/api が使う権限エンジン)と
 * 同じ規則(自己昇格・自己降格判定も同じ規則に依拠)だが、apps/web には依存を追加せず
 * ここで最小限だけ再実装する(apps/web は今回のスコープ外である packages/* への
 * 依存追加を伴わずに完結させたいため。ロジックは1画面のプレビュー表示専用で、
 * サーバー側の判定を代替するものではない — 実際の許可判定は常に apps/api が行う)。
 */

import type { PermissionCatalogEntryDto, PermissionGrantDto, PermissionPresetDto, Scope } from "./api";

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

/** カタログに存在しない「閲覧のみ含意される」内部キーの日本語ラベル(packages/authz/src/implied.ts 参照)。
 * 業務タスクカタログ(30項目)には対応キーが無いため、権限プリセット編集画面の
 * 「この権限には○○の閲覧が含まれます」表示のためだけにここで補う(判断点)。 */
export const INTERNAL_VIEW_LABELS: Record<string, string> = {
  "department.view": "部署ツリーの閲覧",
  "tenant_settings.view": "テナント設定の閲覧",
  "permission_preset.view": "権限プリセット一覧の閲覧",
  "permission_assignment.effective_view": "メンバーの実効権限(できること)の閲覧",
  "api_key.view": "APIキー一覧の閲覧",
};

/**
 * カタログキーの接頭辞から業務グループへ機械的に分類する(依頼:
 * 「カタログのキーの接頭辞から機械的に分類してよい」)。
 * 表示順もこの配列順。
 */
export const PERMISSION_CATEGORIES: readonly { id: string; labelJa: string; prefixes: readonly string[] }[] = [
  { id: "attendance", labelJa: "打刻・申請と承認", prefixes: ["attendance."] },
  { id: "leave", labelJa: "休暇", prefixes: ["leave."] },
  { id: "closing", labelJa: "締めとエクスポート", prefixes: ["closing.", "export.", "alert."] },
  { id: "org", labelJa: "メンバーと組織", prefixes: ["member.", "department."] },
  {
    id: "settings",
    labelJa: "設定と権限",
    prefixes: ["tenant_settings.", "notification.", "permission.", "audit_log.", "api_key."],
  },
] as const;

const OTHER_CATEGORY = { id: "other", labelJa: "その他" } as const;

export function categoryForKey(key: string): { id: string; labelJa: string } {
  for (const cat of PERMISSION_CATEGORIES) {
    if (cat.prefixes.some((p) => key.startsWith(p))) return cat;
  }
  return OTHER_CATEGORY;
}

/** カタログ項目をグループ化して返す(表示順: PERMISSION_CATEGORIES の順、その他は末尾)。 */
export function groupCatalogByCategory(
  catalog: readonly PermissionCatalogEntryDto[],
): { id: string; labelJa: string; entries: PermissionCatalogEntryDto[] }[] {
  const groups = new Map<string, { id: string; labelJa: string; entries: PermissionCatalogEntryDto[] }>();
  for (const entry of catalog) {
    const cat = categoryForKey(entry.key);
    const g = groups.get(cat.id) ?? { id: cat.id, labelJa: cat.labelJa, entries: [] };
    g.entries.push(entry);
    groups.set(cat.id, g);
  }
  const order = [...PERMISSION_CATEGORIES.map((c) => c.id), OTHER_CATEGORY.id];
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
}

/**
 * 選択中(または割当済み)のプリセット群から実効権限を計算する。
 * - 複数プリセットの合算(union)。同一キーは広い方のスコープを採用
 * - 「操作は閲覧を含意」をカタログの impliesView に沿って展開(不動点まで)
 * - カタログ(30業務タスク)に対応キーが無い含意(内部専用の *.view)は業務タスク一覧には出さない
 *   (INTERNAL_VIEW_LABELS はプリセット編集画面の説明文でのみ使う)
 */
export function computeEffectivePermissions(
  presets: readonly { name: string; grants: readonly PermissionGrantDto[] }[],
  catalog: readonly PermissionCatalogEntryDto[],
): EffectivePermissionEntry[] {
  const catalogMap = new Map(catalog.map((e) => [e.key, e]));

  interface Acc {
    scope: Scope;
    sources: Set<string>;
    direct: boolean;
  }
  const combined = new Map<string, Acc>();

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
      return {
        key,
        catalogEntry,
        scope: v.scope,
        sourcePresetNames: Array.from(v.sources).sort(),
        viaImplication: !v.direct,
      };
    })
    .filter((e): e is EffectivePermissionEntry => e !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}
