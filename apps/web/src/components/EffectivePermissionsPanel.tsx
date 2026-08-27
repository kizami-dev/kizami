"use client";

import { groupCatalogByCategory, type EffectivePermissionEntry } from "../lib/permissions";
import { messages } from "../lib/messages";

export interface EffectivePermissionsPanelProps {
  entries: EffectivePermissionEntry[];
}

/**
 * 「このメンバーができること」表示(要件 §4 実効権限ビュー、必須)。
 * 業務タスクの日本語ラベル単位で一覧表示し、適用範囲とどのプリセット由来かを示す。
 *
 * 拒否(deny)された項目(2026-08-24): 一覧からは消さず、ラベルに取り消し線を引いて
 * 「拒否」チップと拒否元プリセット名を添える。付与元が無い権限はそもそも一覧に出ないため、
 * この表示が出るのは「あるプリセットが付与し、別のプリセットが拒否している」衝突時だけ
 * (=管理者が最も理由を知りたい状況)。理由は lib/permissions.ts の denied フラグのコメント参照。
 */
export function EffectivePermissionsPanel({ entries }: EffectivePermissionsPanelProps) {
  if (entries.length === 0) {
    return <p className="effective-perms__empty">{messages.members.effectiveEmpty}</p>;
  }

  const groups = groupCatalogByCategory(entries.map((e) => e.catalogEntry));
  const entryByKey = new Map(entries.map((e) => [e.key, e]));

  return (
    <div className="effective-perms">
      {groups.map((group) => (
        <section key={group.id} className="effective-perms__group">
          <h3 className="effective-perms__group-title">{messages.permissions.categoryLabel[group.id]}</h3>
          <ul className="effective-perms__list">
            {group.entries.map((catalogEntry) => {
              const entry = entryByKey.get(catalogEntry.key);
              if (!entry) return null;
              return (
                <li key={entry.key} className={`effective-perms__item${entry.denied ? " effective-perms__item--denied" : ""}`}>
                  <span className="effective-perms__item-label">
                    {entry.catalogEntry.labelJa}
                    {entry.denied ? <span className="effective-perms__denied-chip">{messages.members.effectiveDeniedChip}</span> : null}
                  </span>
                  <span className="effective-perms__item-scope">
                    {messages.members.effectiveScopeLabel}: {messages.scopeLabel[entry.scope]}
                  </span>
                  <span className="effective-perms__item-source">
                    {messages.members.effectiveSourceLabel}: {entry.sourcePresetNames.join("、")}
                    {entry.viaImplication ? messages.members.effectiveViaImplication : ""}
                  </span>
                  {entry.denied ? (
                    <span className="effective-perms__item-denied-note">
                      {messages.members.effectiveDeniedBy(entry.deniedByPresetNames.join("、"))}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
