import type { CardInstance } from "../game/domain";
import { CARD_TEXT, title } from "./presentation";

/** A hand card. Its rule text is printed on the card (and is its accessible
 * description), so reading a card never needs hover or an extra click. */
export function ActionCard({
  card,
  label,
  selected,
  disabled,
  onPlay,
}: {
  card: CardInstance;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPlay: () => void;
}) {
  const textId = `card-text-${card.id}`;
  return (
    <button
      className={`action-card card-${card.type} ${selected ? "selected" : ""}`}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={label}
      aria-describedby={textId}
      title={CARD_TEXT[card.type]}
      onClick={onPlay}
    >
      <span className="card-name">{title(card.type)}</span>
      <small id={textId}>{CARD_TEXT[card.type]}</small>
    </button>
  );
}
