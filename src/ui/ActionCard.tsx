import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardInstance } from "../game/domain";
import { CARD_TEXT, title } from "./presentation";

export function ActionCard({
  card,
  label,
  selected,
  disabled,
  onPlay,
  open,
  onShow,
  onHide,
}: {
  card: CardInstance;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPlay: () => void;
  open: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const textId = `card-text-${card.id}`;

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }
  function show() {
    cancelClose();
    onShow();
  }
  function hide() {
    cancelClose();
    onHide();
  }
  function leave() {
    cancelClose();
    // Allow the pointer to cross the gap and read the tooltip itself.
    closeTimer.current = setTimeout(onHide, 120);
  }
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!button.current || !tooltip.current) return;
      const anchor = button.current.getBoundingClientRect();
      const hand =
        button.current.closest(".hand")?.getBoundingClientRect() ?? anchor;
      const tip = tooltip.current.getBoundingClientRect();
      const beside = hand.left - tip.width - 12 >= 12;
      const below = hand.bottom + 8;
      setPosition({
        left: Math.max(
          12,
          Math.min(
            beside
              ? hand.left - tip.width - 12
              : anchor.left + (anchor.width - tip.width) / 2,
            window.innerWidth - tip.width - 12,
          ),
        ),
        top: Math.max(
          12,
          Math.min(
            window.innerHeight - tip.height - 12,
            beside
              ? anchor.top + (anchor.height - tip.height) / 2
              : below + tip.height <= window.innerHeight - 12
                ? below
                : hand.top - tip.height - 8,
          ),
        ),
      });
    }
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") onHide();
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open, onHide]);

  return (
    <>
      <button
        ref={button}
        className={`action-card ${selected ? "selected" : ""}`}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={label}
        aria-describedby={textId}
        onPointerEnter={show}
        onPointerLeave={leave}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={hide}
        onClick={() => {
          hide();
          onPlay();
        }}
      >
        <span>{title(card.type)}</span>
        <small id={textId}>{CARD_TEXT[card.type]}</small>
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            role="tooltip"
            className="action-tooltip"
            style={position}
            onPointerEnter={show}
            onPointerLeave={leave}
          >
            <strong>{title(card.type)}</strong>
            <p>{CARD_TEXT[card.type]}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
