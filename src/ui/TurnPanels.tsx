import { useState } from "react";
import { FACTIONS } from "../game/domain";
import { CARD_TEXT, describeEffect, title } from "./presentation";
import type { HotseatTurn } from "./useHotseatTurn";
import { ActionCard } from "./ActionCard";

type Actions = HotseatTurn["actions"];

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
  const { table, selectedCard } = turn;
  const [helpCard, setHelpCard] = useState<string | null>(null);
  return (
    <>
      <div className="section-title">
        <h2>Your hand</h2>
        <span>{table.hand.length} cards remaining</span>
      </div>
      <div className="hand">
        {table.hand.map((card, index) => {
          const copy =
            card.type === "assemble"
              ? ` ${table.hand.slice(0, index + 1).filter((item) => item.type === "assemble").length}`
              : "";
          return (
            <ActionCard
              key={card.id}
              card={card}
              selected={selectedCard?.id === card.id}
              disabled={!turn.availableCardIds.includes(card.id)}
              label={`Play ${title(card.type)}${copy}`}
              onPlay={() => actions.startCard(card.id)}
              open={helpCard === card.id}
              onShow={() => setHelpCard(card.id)}
              onHide={() =>
                setHelpCard((current) => (current === card.id ? null : current))
              }
            />
          );
        })}
      </div>
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
      <details className="card-help">
        <summary>{title(selectedCard.type)} · rules</summary>
        <p className="selected-card-rule">{CARD_TEXT[selectedCard.type]}</p>
      </details>
      {selection?.kind === "card" && selection.effect === null && decision && (
        <>
          <h3>{decision.label}</h3>
          {picks.length > 0 && (
            <p
              className="picked-targets"
              title={picks.map((pick) => pick.label).join(" → ")}
            >
              Selected: {picks.map((pick) => pick.label).join(" → ")}
            </p>
          )}
          <div className="effect-tools">
            <details className="effect-alternatives">
              <summary>Choose from a list</summary>
              <div className="choices">
                {decision.options.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => actions.pick(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </details>
            {picks.length > 0 && (
              <button className="quiet" onClick={actions.undoPick}>
                Undo last selection
              </button>
            )}
          </div>
        </>
      )}
      {selection?.kind === "card" && selection.effect && (
        <details className="effect-summary">
          <summary>Effect applied · view details</summary>
          <p>{describeEffect(selection.effect)}</p>
        </details>
      )}
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
      <h3>Summon one highlighted follower</h3>
      <details
        className="summon-alternatives"
        open={turn.summonChoices[0]?.kind === "zero"}
      >
        <summary>Choose from a list</summary>
        <div className="summon-choices">
          {turn.summonChoices.map((summon, index) => (
            <button key={index} onClick={() => actions.summon(summon)}>
              {summon.kind === "zero" ? (
                "Confirm zero summon — no eligible followers"
              ) : (
                <>
                  <span
                    className={`cube ${summon.faction}`}
                    aria-hidden="true"
                  />
                  {title(summon.faction)} · {title(summon.regionId)}
                </>
              )}
            </button>
          ))}
        </div>
      </details>
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
  const { selection, plan } = turn;
  const selected = selection !== null && selection.kind !== "unselected";
  const status =
    plan?.kind === "pass"
      ? turn.passCompletesRound
        ? "Pass selected · resolves the next power struggle."
        : "Pass selected · no follower is summoned."
      : plan?.kind === "card"
        ? plan.summon.kind === "zero"
          ? "Preview · No followers available to summon."
          : `Preview · Summon 1 ${title(plan.summon.faction)} from ${title(plan.summon.regionId)}.`
        : selected
          ? "Complete the highlighted choices to end your turn."
          : "Choose a card, or pass.";
  return (
    <div className="turn-controls">
      <div className="commit-bar">
        <button
          className="primary turn-primary"
          disabled={selected && plan === null}
          onClick={selected ? actions.endTurn : actions.pass}
          aria-describedby="turn-status"
        >
          {selected ? "End Turn" : "Pass"}
        </button>
        <button disabled={!selected} onClick={actions.reset}>
          Reset Turn
        </button>
      </div>
      <p
        id="turn-status"
        className={`turn-status ${plan ? "turn-ready" : ""}`}
        role="status"
        aria-label="Turn preview"
      >
        {status}
      </p>
    </div>
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
