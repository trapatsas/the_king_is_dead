import { FACTIONS } from "../game/domain";
import { Followers } from "./Board";
import { CARD_TEXT, describeEffect, title } from "./presentation";
import type { HotseatTurn } from "./useHotseatTurn";

type Actions = HotseatTurn["actions"];

export function PrivacyCurtain({
  player,
  onReveal,
}: {
  player: string;
  onReveal: () => void;
}) {
  return (
    <section className="privacy-panel">
      <span className="privacy-symbol" aria-hidden="true">
        ♜
      </span>
      <span className="eyebrow">Private court</span>
      <h2>Pass to {player}</h2>
      <p>
        Only {player} should reveal this hand. Other players should look away.
      </p>
      <button autoFocus className="primary" onClick={onReveal}>
        Reveal {player}’s hand
      </button>
    </section>
  );
}

export function PlotPanel({
  player,
  onChoose,
}: {
  player: string;
  onChoose: Actions["choosePlot"];
}) {
  return (
    <section>
      <span className="eyebrow">Plot revealed</span>
      <h2>Choose your allegiance</h2>
      <p>
        {player}, choose one virtual follower for final scoring. The court and
        supply stay unchanged.
      </p>
      {FACTIONS.map((faction) => (
        <button
          className="plot-choice-button"
          key={faction}
          onClick={() => onChoose(faction)}
        >
          Support {title(faction)}
        </button>
      ))}
    </section>
  );
}

export function HandPanel({
  turn,
  actions,
}: {
  turn: HotseatTurn;
  actions: Actions;
}) {
  const { table, selectedCard, selection } = turn;
  return (
    <>
      <div className="section-title">
        <h2>Your hand</h2>
        <button className="quiet" onClick={actions.hide}>
          Hide hand
        </button>
      </div>
      <p className="hint">
        Choose one card, or pass. Cards are spent only at End Turn.
      </p>
      <div className="hand">
        {table.hand.map((card, index) => {
          const textId = `card-text-${card.id}`;
          const copy =
            card.type === "assemble"
              ? ` ${table.hand.slice(0, index + 1).filter((item) => item.type === "assemble").length}`
              : "";
          return (
            <button
              key={card.id}
              className={`action-card ${selectedCard?.id === card.id ? "selected" : ""}`}
              disabled={!turn.availableCardIds.includes(card.id)}
              aria-pressed={selectedCard?.id === card.id}
              aria-label={`Play ${title(card.type)}${copy}`}
              aria-describedby={textId}
              onClick={() => actions.startCard(card.id)}
            >
              <span>{title(card.type)}</span>
              <small id={textId}>{CARD_TEXT[card.type]}</small>
            </button>
          );
        })}
      </div>
      <button
        className={`pass-button ${selection?.kind === "pass" ? "selected" : ""}`}
        aria-pressed={selection?.kind === "pass"}
        onClick={actions.pass}
      >
        Pass
      </button>
    </>
  );
}

export function EffectChoicePanel({
  turn,
  actions,
}: {
  turn: HotseatTurn;
  actions: Actions;
}) {
  const { selectedCard, selection, decision, picks } = turn;
  if (!selectedCard) return null;
  return (
    <section className="choice-panel" aria-label="Card effect">
      <span className="eyebrow">1 · Resolve {title(selectedCard.type)}</span>
      {selection?.kind === "card" && selection.effect === null && decision && (
        <>
          <h3>{decision.label}</h3>
          <p className="hint">
            {decision.options[0]?.kind === "follower"
              ? "Click a highlighted follower on the board, or choose below. Click the same faction again to select a second follower."
              : "Click a highlighted region/card, or choose below."}
          </p>
          {picks.length > 0 && (
            <p className="picked-targets">
              Selected: {picks.map((pick) => pick.label).join(" → ")}
            </p>
          )}
          <div className="choices" key={decision.key}>
            {decision.options.map((option) => (
              <button key={option.key} onClick={() => actions.pick(option.key)}>
                {option.label}
              </button>
            ))}
          </div>
          {picks.length > 0 && (
            <button className="quiet" onClick={actions.undoPick}>
              Undo last selection
            </button>
          )}
        </>
      )}
      {selection?.kind === "card" && selection.effect && (
        <p>{describeEffect(selection.effect)}</p>
      )}
      {selectedCard.type === "outmanoeuvre" && (
        <p className="hint">
          The two return followers can be the same or different factions. A
          legal 1-for-2 swap is required whenever possible anywhere; otherwise
          the engine offers 1-for-1.
        </p>
      )}
      <button
        className="quiet"
        onClick={() => actions.startCard(selectedCard.id)}
      >
        Restart effect choices
      </button>
    </section>
  );
}

export function SummonPanel({
  turn,
  actions,
}: {
  turn: HotseatTurn;
  actions: Actions;
}) {
  if (turn.step !== "choose-summon") return null;
  return (
    <section className="choice-panel" aria-label="Summon a follower">
      <span className="eyebrow">2 · Grow your court</span>
      <h3>Summon one follower</h3>
      <p className="hint">
        Click a highlighted follower on the board, or choose below. The board
        shows your card’s effect.
      </p>
      <div className="summon-choices">
        {turn.summonChoices.map((summon, index) => (
          <button key={index} onClick={() => actions.summon(summon)}>
            {summon.kind === "zero" ? (
              "Confirm zero summon — no eligible followers"
            ) : (
              <>
                <span className={`cube ${summon.faction}`} aria-hidden="true" />
                {title(summon.faction)} · {title(summon.regionId)}
              </>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

export function PlanSummary({ turn }: { turn: HotseatTurn }) {
  const { plan, selectedCard } = turn;
  if (!plan) return null;
  return (
    <section
      className="plan-summary"
      aria-label="Final turn summary"
      tabIndex={-1}
    >
      <span className="eyebrow">Ready to commit</span>
      <h3>
        {plan.kind === "pass"
          ? "Pass this turn"
          : `Play ${selectedCard ? title(selectedCard.type) : "card"}`}
      </h3>
      {plan.kind === "pass" ? (
        <p>
          {turn.passCompletesRound
            ? "This completes the pass round and resolves the next power struggle."
            : "One more consecutive pass. No follower is summoned."}
        </p>
      ) : (
        <>
          <p>{describeEffect(plan.effect)}</p>
          <p>
            {plan.summon.kind === "zero"
              ? "Summon zero: no followers remain in uncontrolled regions."
              : `Summon 1 ${title(plan.summon.faction)} from ${title(plan.summon.regionId)}.`}
          </p>
        </>
      )}
      <p className="hint">
        End Turn commits this choice and hands over the device.
      </p>
    </section>
  );
}

export function CommitBar({
  turn,
  actions,
}: {
  turn: HotseatTurn;
  actions: Actions;
}) {
  const { selection, committed } = turn;
  return (
    <>
      {selection?.kind === "card" && selection.effect !== null && (
        <p className="preview-badge" role="status">
          Preview shown on board and courts · not committed
        </p>
      )}
      <div className="commit-bar">
        <button onClick={actions.reset}>Reset Turn</button>
        <button
          className="primary"
          disabled={turn.plan === null}
          onClick={actions.endTurn}
        >
          End Turn
        </button>
      </div>
      <details className="committed-info">
        <summary>Committed position</summary>
        <p>
          Turn {committed.turn}; {committed.passes} consecutive passes. Your
          court before this draft:
        </p>
        {committed.court && (
          <Followers counts={committed.court} label="Committed court" />
        )}
      </details>
    </>
  );
}

export function FinishedPanel() {
  return (
    <section className="privacy-panel">
      <span aria-hidden="true" className="privacy-symbol">
        ♜
      </span>
      <h2>Game complete</h2>
      <p>
        Open the result explanation to see the court comparisons and tiebreaks.
      </p>
    </section>
  );
}
