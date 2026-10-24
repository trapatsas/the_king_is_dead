import { FACTIONS } from "../game/domain";
import {
  BOT_AGENT_NAMES,
  BOT_STRATEGY_LABELS,
  CARD_TEXT,
  describeEffect,
  forecast,
  regionLeader,
  title,
} from "./presentation";
import type { HotseatTurn } from "./useHotseatTurn";
import { ActionCard } from "./ActionCard";

type Actions = HotseatTurn["actions"];

const STEPS = [
  { key: "choose-turn", label: "Card" },
  { key: "choose-effect", label: "Effect" },
  { key: "choose-summon", label: "Summon" },
  { key: "ready", label: "End turn" },
] as const;

/** Where the player is in the play → effect → summon → commit sequence. */
export function TurnSteps({ turn }: { turn: HotseatTurn }) {
  const passing = turn.selection?.kind === "pass";
  const current = STEPS.findIndex((step) => step.key === turn.step);
  return (
    <ol className="turn-steps" aria-label="Turn progress">
      {STEPS.map((step, index) => {
        const skipped = passing && index > 0 && index < 3;
        return (
          <li
            key={step.key}
            className={
              index === current
                ? "current"
                : index < current && !skipped
                  ? "done"
                  : skipped
                    ? "skipped"
                    : ""
            }
            aria-current={index === current ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            {index === 0 && passing ? "Pass" : step.label}
          </li>
        );
      })}
    </ol>
  );
}

export function BotPanel({
  turn,
  player,
}: {
  turn: HotseatTurn;
  player: string;
}) {
  const { bot } = turn;
  return (
    <section className="bot-panel" aria-label="Bot turn" aria-busy={!bot.error}>
      {!bot.error && <span className="spinner" aria-hidden="true" />}
      <div>
        <span className="eyebrow">{BOT_STRATEGY_LABELS[bot.strategy]} bot</span>
        <p className="hint bot-agent">Agent: {BOT_AGENT_NAMES[bot.strategy]}</p>
        <h2>
          {bot.error
            ? "Bot turn paused"
            : bot.loading
              ? "Loading learned model"
              : `${player} is thinking`}
        </h2>
        {bot.error ? (
          <>
            <p role="alert" className="error">
              {bot.error}
            </p>
            <button className="primary" onClick={bot.retry}>
              Retry bot turn
            </button>
          </>
        ) : (
          <p role="status" className="hint">
            Considering the court, the next struggle, and possible replies…
          </p>
        )}
      </div>
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
    <section className="step-panel plot-panel" aria-label="Plot">
      <span className="eyebrow">Plot revealed</span>
      <h2>Choose your allegiance</h2>
      <p className="hint">
        {player}, choose one virtual follower for final scoring. The court and
        supply stay unchanged.
      </p>
      <div className="plot-choices">
        {FACTIONS.map((faction) => (
          <button
            className={`plot-choice-button ${faction}`}
            key={faction}
            onClick={() => onChoose(faction)}
          >
            <span className={`mark ${faction}`} aria-hidden="true" />
            Support {title(faction)}
          </button>
        ))}
      </div>
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
  return (
    <section className="hand-panel" aria-label="Your hand">
      <div className="panel-title">
        <h2>Your hand</h2>
        <span>
          {table.hand.length} {table.hand.length === 1 ? "card" : "cards"} left
          {selectedCard && " · click another card to switch"}
        </span>
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
            />
          );
        })}
      </div>
    </section>
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
  const deciding =
    selection?.kind === "card" && selection.effect === null && decision;
  return (
    <section className="step-panel" aria-label="Card effect">
      <div className="step-card">
        <span className="eyebrow">{title(selectedCard.type)}</span>
        <p className="step-rule">{CARD_TEXT[selectedCard.type]}</p>
      </div>
      {deciding && (
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
                    {option.kind === "follower" && (
                      <span
                        className={`mark ${option.faction}`}
                        aria-hidden="true"
                      />
                    )}
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
        <p className="effect-done">
          <span className="check" aria-hidden="true">
            ✓
          </span>
          <span>{describeEffect(selection.effect)}</span>
        </p>
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
  const zero = turn.summonChoices[0]?.kind === "zero";
  return (
    <section className="step-panel" aria-label="Summon a follower">
      <h3>Summon one follower to your court</h3>
      <p className="step-hint" role="status">
        {zero
          ? "No followers remain; confirm zero summon."
          : "Select a highlighted follower on the map."}
      </p>
      {zero ? (
        <div className="summon-choices">
          {turn.summonChoices.map((summon, index) => (
            <button
              key={index}
              className="primary"
              onClick={() => actions.summon(summon)}
            >
              Confirm zero summon — no eligible followers
            </button>
          ))}
        </div>
      ) : (
        <details className="summon-alternatives">
          <summary>Choose from a list</summary>
          <div className="summon-choices choices">
            {turn.summonChoices.map((summon, index) =>
              summon.kind === "zero" ? null : (
                <button key={index} onClick={() => actions.summon(summon)}>
                  <span
                    className={`mark ${summon.faction}`}
                    aria-hidden="true"
                  />
                  {title(summon.faction)} · {title(summon.regionId)}
                </button>
              ),
            )}
          </div>
        </details>
      )}
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
  const { selection, plan, table } = turn;
  const selected = selection !== null && selection.kind !== "unselected";
  const pending = table.regionCards.find((card) => card.faceUp)?.regionId;
  const status =
    plan?.kind === "pass"
      ? turn.passCompletesRound
        ? `Pass selected · resolves the next power struggle${pending ? `: ${title(pending)} — ${forecast(regionLeader(table.regions[pending].followers))}` : ""}.`
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
      <p
        id="turn-status"
        className={`turn-status ${plan ? "turn-ready" : ""}`}
        role="status"
        aria-label="Turn preview"
      >
        {status}
      </p>
      <div className="commit-bar">
        <button
          className="secondary"
          disabled={!selected}
          onClick={actions.reset}
        >
          Reset Turn
        </button>
        <button
          className={`primary turn-primary ${plan ? "is-ready" : ""}`}
          disabled={selected && plan === null}
          onClick={selected ? actions.endTurn : actions.pass}
          aria-describedby="turn-status"
        >
          {selected ? "End Turn" : "Pass"}
        </button>
      </div>
    </div>
  );
}
