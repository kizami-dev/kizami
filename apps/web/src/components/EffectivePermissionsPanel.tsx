"use client";

import { groupCatalogByCategory, type EffectivePermissionEntry } from "../lib/permissions";
import { messages } from "../lib/messages";

export interface EffectivePermissionsPanelProps {
  entries: EffectivePermissionEntry[];
}

/**
 * 「このメンバーができること」表示(要件 §4 実効権限ビュー、必須)。
 * 業務タスクの日本語ラベル単位で一覧表示し、適用範囲とどのプリセット由来かを示す。
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
          <h3 className="effective-perms__group-title">{group.labelJa}</h3>
          <ul className="effective-perms__list">
            {group.entries.map((catalogEntry) => {
              const entry = entryByKey.get(catalogEntry.key);
              if (!entry) return null;
              return (
                <li key={entry.key} className="effective-perms__item">
                  <span className="effective-perms__item-label">{entry.catalogEntry.labelJa}</span>
                  <span className="effective-perms__item-scope">
                    {messages.members.effectiveScopeLabel}: {messages.scopeLabel[entry.scope]}
                  </span>
                  <span className="effective-perms__item-source">
                    {messages.members.effectiveSourceLabel}: {entry.sourcePresetNames.join("、")}
                    {entry.viaImplication ? messages.members.effectiveViaImplication : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
