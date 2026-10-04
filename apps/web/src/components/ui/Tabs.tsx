"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * 画面内の切り替え(components.css の .tabs)。WAI-ARIA の tablist パターン:
 * 選択中のタブだけ Tab キーで入り、左右の矢印・Home・End で移る。
 * 切り替え先の本文は呼び出し側が role="tabpanel"、id=`${idPrefix}-panel-${id}`、
 * aria-labelledby=`${idPrefix}-tab-${id}` で描く。
 */
export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix,
}: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  idPrefix: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA の tablist パターン。
    <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA の tab。
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, t.id)}
            tabIndex={selected ? 0 : -1}
            className={`tabs__tab${selected ? " tabs__tab--selected" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
