import { useEffect, useRef } from "react";
export default function useDialogFocus(open, onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement,
      dialog = document.querySelector(".accounting-dialog");
    if (!dialog) return;
    const focusable = () =>
      [
        ...dialog.querySelectorAll(
          'input,select,textarea,button,[tabindex="0"]',
        ),
      ].filter((el) => !el.disabled && el.getClientRects().length);
    focusable()[0]?.focus();
    const handle = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (!first) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener("keydown", handle);
    return () => {
      dialog.removeEventListener("keydown", handle);
      previous?.focus?.();
    };
  }, [open]);
}
