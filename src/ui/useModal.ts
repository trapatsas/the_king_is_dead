import { useEffect } from "react";
import type { RefObject } from "react";

/** Opens a native <dialog> modally for the component's lifetime, focuses the
 * given control, and returns focus to the opener (or `returnFocus`) on close. */
export function useModal(
  dialog: RefObject<HTMLDialogElement | null>,
  initialFocus: RefObject<HTMLElement | null>,
  returnFocus?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement;
    if (typeof node?.showModal === "function") node.showModal();
    else node?.setAttribute("open", "");
    initialFocus.current?.focus();
    return () => {
      if (typeof node?.close === "function") node.close();
      const target = returnFocus?.current ?? opener;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
    // Mount/unmount only: the dialog lives exactly as long as the component.
  }, []);
}
