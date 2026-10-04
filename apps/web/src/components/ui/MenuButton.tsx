"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * 「…」メニュー(行の操作を畳む)。WAI-ARIA の menu button パターン。
 *
 * - ボタンで開閉。開くと最初の項目にフォーカス
 * - ↓↑ で項目を移動(端で循環)、Home / End で先頭・末尾、Esc で閉じてボタンへ戻る
 * - Tab・外側のクリックでも閉じる
 * - メニューは position: fixed でボタンの下に出す。表の横スクロール枠(overflow)に切られないため
 */
export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** 取り消せない・影響の大きい操作(M 色の文字)。 */
  danger?: boolean;
  disabled?: boolean;
}

export function MenuButton({ label, items }: { label: string; items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function enabledItems(): HTMLButtonElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  }

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const list = enabledItems();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(index + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(index - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--ghost btn--sm menu-button__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <span aria-hidden="true">…</span>
      </button>
      {open && pos ? (
        // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA の menu パターン。
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className="menu-button__menu" style={{ top: pos.top, right: pos.right }} onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA の menuitem。
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`menu-button__item${item.danger ? " menu-button__item--danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
