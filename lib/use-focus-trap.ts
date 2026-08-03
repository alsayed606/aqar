"use client";
import { useEffect, useRef } from "react";

// Keyboard containment for dialogs, per docs/foundation/08 §7.1.
//
// Nesting is why this keeps a stack: a confirmation modal often opens while the drawer's own trap is
// still mounted. Without the stack both answer the same Escape and fight over Tab. Only the topmost
// trap responds. Aqar already nests drawers (Drawer's `zClass` exists for exactly that), so this is
// a real case here, not a hypothetical one.
const stack: HTMLElement[] = [];

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(node: HTMLElement): HTMLElement[] {
  // Deliberately no layout-based visibility check. offsetParent is null for every element under
  // jsdom, which does no layout, and that would silently empty this list in tests. These dialogs
  // hide content by not rendering it, so a hidden control is absent from the DOM rather than
  // present-but-invisible.
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden"));
}

export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose?: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const opener = document.activeElement as HTMLElement | null;
    stack.push(node);

    const first = focusableWithin(node)[0];
    if (first) first.focus();
    else {
      node.setAttribute("tabindex", "-1");
      node.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== node) return; // a nested dialog owns the keys
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !node) return;

      const items = focusableWithin(node);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const inside = node.contains(document.activeElement);

      if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const i = stack.indexOf(node);
      if (i !== -1) stack.splice(i, 1);
      // Only if it is still in the document — the row that opened the dialog can disappear when the
      // list refreshes underneath it.
      if (opener?.focus && document.contains(opener)) opener.focus();
    };
  }, [active]);

  return ref;
}
