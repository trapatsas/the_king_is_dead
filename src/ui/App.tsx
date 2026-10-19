import { useEffect, useMemo, useRef, useState } from "react";
import {
  beginTurn,
  draftCard,
  draftEffect,
  draftPass,
  draftSummon,
  resetTurn,
} from "../app/draft";
import { choosePlot, endTurn } from "../app/session";
import { FACTIONS } from "../game/domain";
import type { RegionId, SetupConfig } from "../game/domain";
import type { GameSession } from "../game/events";
import { createGame } from "../game/setup";
import { turnEngine } from "../game/turns";
import type { TurnDraft } from "../game/turnTypes";
import { Board, Followers, RegionTrack } from "./Board";
import { GameLogPanel } from "./GameLogPanel";
import { projectFinishedLog } from "./finishedLog";
import {
  beginEffectChoice,
  completedEffect,
  effectDecision,
  pickEffectOption,
  undoEffectPick,
} from "./effectChoices";
import type { EffectChoice, FollowerPick } from "./effectChoices";
import {
  CARD_TEXT,
  describeEffect,
  projectTable,
  publicNotices,
  title,
} from "./presentation";
import { Result } from "./Result";
import { Setup } from "./Setup";
import { ThemeToggle } from "./ThemeToggle";

function initialDraft(session: GameSession): TurnDraft | null {
  return session.state.phase === "turn" ? beginTurn(session.state) : null;
}

function LeaveDialog({
  onKeep,
  onLeave,
}: {
  onKeep: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (typeof dialog?.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    return () => {
      if (typeof dialog?.close === "function") dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="new-game-dialog"
      aria-label="Start a new game"
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
    >
      <h2>Leave this kingdom?</h2>
      <p>Your current game will be lost. Games are not saved yet.</p>
      <button autoFocus onClick={onKeep}>
        Keep playing
      </button>
      <button onClick={onLeave}>Leave game</button>
    </dialog>
  );
}

export function App({ initialSession }: { initialSession?: GameSession }) {
  const [session, setSession] = useState<GameSession | null>(
    initialSession ?? null,
  );
  const [confirmNew, setConfirmNew] = useState(false);
  function start(config: SetupConfig) {
    setSession(createGame(config));
  }
  return (
    <>
      <header className="app-header">
        <a
          className="wordmark"
          href="#"
          onClick={(event) => event.preventDefault()}
        >
          <span aria-hidden="true">♜</span> THE KING IS DEAD
        </a>
        <span className="edition">PROJECT RULESET · 2–3 PLAYERS</span>
        <div className="header-actions">
          <ThemeToggle />
          {session && (
            <button className="quiet" onClick={() => setConfirmNew(true)}>
              New game
            </button>
          )}
        </div>
      </header>
      {confirmNew && (
        <LeaveDialog
          onKeep={() => setConfirmNew(false)}
          onLeave={() => {
            setSession(null);
            setConfirmNew(false);
          }}
        />
      )}
      {session ? (
        <Game
          key={session.state.initialSeed + session.state.startingPlayerId}
          initialSession={session}
        />
      ) : (
        <Setup onStart={start} />
      )}
      <footer className="app-footer">
        An empty throne. A divided kingdom. An uncertain alliance.
      </footer>
    </>
  );
}

export function Game({ initialSession }: { initialSession: GameSession }) {
  const [session, setSession] = useState(initialSession);
  const [draft, setDraft] = useState<TurnDraft | null>(() =>
    initialDraft(initialSession),
  );
  const [revealed, setRevealed] = useState<string | null>(null);
  const [effectChoice, setEffectChoice] = useState<EffectChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plannerRef = useRef<HTMLElement>(null);
  const choiceOrigin = useRef<"board" | "panel">("panel");
  const { state } = session;
  const targetPlayer =
    state.phase === "plot-choice"
      ? (state.plot?.playerId ?? state.activePlayerId)
      : state.activePlayerId;
  const visible = revealed === targetPlayer && state.phase !== "finished";
  const preview = useMemo(
    () => (draft ? turnEngine.previewTurn(state, draft) : null),
    [state, draft],
  );
  const committed = projectTable(state, null);
  const table = projectTable(
    visible && preview ? preview.state : state,
    visible ? targetPlayer : null,
  );
  const decision = effectChoice ? effectDecision(effectChoice) : null;
  const decisionKey = decision?.key;
  const step = preview?.step;
  useEffect(() => {
    if (!visible) return;
    if (
      choiceOrigin.current === "board" &&
      (step === "choose-effect" || step === "choose-summon")
    )
      return;
    const selector =
      state.phase === "plot-choice"
        ? ".plot-choice-button"
        : step === "choose-effect"
          ? ".choices button"
          : step === "choose-summon"
            ? ".summon-choices button"
            : step === "ready"
              ? ".plan-summary"
              : ".action-card:not(:disabled), .pass-button";
    plannerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [visible, step, decisionKey, state.phase]);
  const regionOptions =
    visible && decision
      ? decision.options
          .filter((option) => option.kind === "region")
          .map((option) => option.regionId)
      : [];
  const followerOptions: readonly FollowerPick[] = !visible
    ? []
    : preview?.step === "choose-summon"
      ? preview.summonChoices.flatMap((summon) =>
          summon.kind === "follower"
            ? [{ regionId: summon.regionId, faction: summon.faction }]
            : [],
        )
      : (decision?.options.flatMap((option) =>
          option.kind === "follower"
            ? [{ regionId: option.regionId, faction: option.faction }]
            : [],
        ) ?? []);
  const selectedFollowers =
    (visible ? effectChoice?.picks : undefined)?.flatMap((pick) =>
      pick.kind === "follower"
        ? [{ regionId: pick.regionId, faction: pick.faction }]
        : [],
    ) ?? [];
  function updateEffectChoice(nextDraft: TurnDraft, choice: EffectChoice) {
    const effect = completedEffect(choice);
    setDraft(effect ? draftEffect(nextDraft, effect) : nextDraft);
    setEffectChoice(effect ? null : choice);
  }
  function startCard(cardId: string) {
    if (!draft) return;
    choiceOrigin.current = "panel";
    const next = draftCard(draft, cardId);
    updateEffectChoice(
      next,
      beginEffectChoice(turnEngine.previewTurn(state, next).effectPlans),
    );
  }
  function selectValue(key: string, origin: "board" | "panel" = "panel") {
    if (!effectChoice || !draft) return;
    choiceOrigin.current = origin;
    updateEffectChoice(draft, pickEffectOption(effectChoice, key));
  }
  function selectRegion(region: RegionId) {
    selectValue(`region:${region}`, "board");
  }
  function selectFollower(pick: FollowerPick) {
    choiceOrigin.current = "board";
    if (preview?.step === "choose-summon" && draft) {
      const summon = preview.summonChoices.find(
        (option) =>
          option.kind === "follower" &&
          option.regionId === pick.regionId &&
          option.faction === pick.faction,
      );
      if (summon) setDraft(draftSummon(draft, summon));
    } else selectValue(`follower:${pick.regionId}:${pick.faction}`, "board");
  }
  function accept(next: GameSession) {
    setSession(next);
    setDraft(initialDraft(next));
    setEffectChoice(null);
    choiceOrigin.current = "panel";
    setRevealed(null);
    setError(null);
  }
  function safely(action: () => void) {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The turn could not be accepted.",
      );
    }
  }
  const selection = draft?.selection;
  const selectedCard =
    selection?.kind === "card"
      ? table.hand.find((card) => card.id === selection.cardId)
      : null;
  const notices = publicNotices(session.events);
  const availableCards =
    visible && state.phase === "turn"
      ? turnEngine.getAvailableCards(state, targetPlayer)
      : [];
  return (
    <main className="game-layout">
      <section className="game-heading">
        <div>
          <span className="eyebrow">
            {title(state.mode)} kingdom · seed {table.seed}
          </span>
          <h1>
            {state.phase === "finished"
              ? "The kingdom has spoken"
              : state.phase === "plot-choice"
                ? "One final allegiance"
                : `${targetPlayer}’s turn`}
          </h1>
        </div>
        <div className="turn-indicator">
          TURN {table.turn}
          <span>
            {table.passes}/{state.playerOrder.length} consecutive passes
          </span>
        </div>
      </section>
      <details className="how-to">
        <summary>How to play</summary>
        <p>
          Play one action card, complete its effect, then summon one follower
          from an uncontrolled region to your court. Or pass. Review your
          preview and choose End Turn to commit. Reset Turn clears your choices.
        </p>
        <p>
          When everyone passes consecutively, the next region resolves. A unique
          largest faction gains control; a tie causes instability. Three
          unstable regions cause an Invasion, scored by complete court sets.
          Otherwise all eight struggles lead to a Coronation, scored by faction
          power and court support. Each player has only eight action cards for
          the entire game.
        </p>
        <p>
          The engine offers only legal choices and requires the greatest
          achievable effect. A region carrying a negotiation disc cannot be
          exchanged. Another player cannot immediately undo a Manoeuvre or
          Outmanoeuvre with either swap card.
        </p>
      </details>
      {state.result && <Result result={state.result} />}
      {state.phase === "finished" && state.result && (
        <GameLogPanel entries={projectFinishedLog(session)} />
      )}
      {notices.length > 0 && (
        <section
          className="notice struggle-notice"
          aria-label="Power struggle report"
        >
          <strong>Kingdom dispatch</strong>
          <p role="status">{notices.at(-1)}</p>
          <details>
            <summary>Struggle history</summary>
            <ol>
              {notices.map((notice, index) => (
                <li key={index}>{notice}</li>
              ))}
            </ol>
          </details>
        </section>
      )}
      <RegionTrack
        table={table}
        choices={regionOptions}
        onRegion={regionOptions.length ? selectRegion : null}
        selectedRegions={
          (visible ? effectChoice?.picks : undefined)
            ?.filter((pick) => pick.kind === "region")
            .map((pick) => pick.regionId) ?? []
        }
      />
      <div className="table-layout">
        <div>
          <Board
            table={table}
            choices={regionOptions}
            onRegion={regionOptions.length ? selectRegion : null}
            followerChoices={followerOptions}
            onFollower={followerOptions.length ? selectFollower : null}
            selectedFollowers={selectedFollowers}
            instruction={
              visible
                ? preview?.step === "choose-summon"
                  ? followerOptions.length
                    ? "Preview · Summon one follower into your court"
                    : "Preview · No followers remain; confirm zero summon in the turn panel"
                  : (decision?.label ?? null)
                : null
            }
          />
          <section className="supply-panel" aria-label="Shared supply">
            <div>
              <h3>Common supply</h3>
              <Followers counts={table.supply} label="Followers in supply" />
            </div>
            <div>
              <h3>Control discs remaining</h3>
              <Followers
                counts={table.controlDiscs}
                label="Control discs in supply"
              />
            </div>
            <div>
              <h3>Instability</h3>
              <span
                className="instability"
                aria-label={`${table.instability} of 3 instability discs placed`}
              >
                {Array.from({ length: 3 }, (_, index) => (
                  <span
                    className={index < table.instability ? "placed" : ""}
                    key={index}
                  >
                    ✕
                  </span>
                ))}
              </span>
            </div>
          </section>
          <section aria-label="Player courts" className="courts">
            {table.players.map((player) => (
              <article
                key={player.id}
                className={`court ${player.id === targetPlayer ? "active-court" : ""}`}
              >
                <div className="court-heading">
                  <h3>{player.id}</h3>
                  <span>{player.handCount} cards</span>
                </div>
                <Followers counts={player.court} label={`${player.id} court`} />
                <p>
                  Top discard:{" "}
                  <strong>
                    {player.discardTop ? title(player.discardTop.type) : "None"}
                  </strong>
                </p>
                <p>
                  Negotiation disc:{" "}
                  {player.negotiationDiscLocation
                    ? title(player.negotiationDiscLocation)
                    : "Available"}
                </p>
              </article>
            ))}
          </section>
        </div>
        <aside
          ref={plannerRef}
          className="turn-panel"
          aria-label="Turn planner"
        >
          {state.phase !== "finished" && !visible && (
            <section className="privacy-panel">
              <span className="privacy-symbol" aria-hidden="true">
                ♜
              </span>
              <span className="eyebrow">Private court</span>
              <h2>Pass to {targetPlayer}</h2>
              <p>
                Only {targetPlayer} should reveal this hand. Other players
                should look away.
              </p>
              <button
                autoFocus
                className="primary"
                onClick={() => setRevealed(targetPlayer)}
              >
                Reveal {targetPlayer}’s hand
              </button>
            </section>
          )}
          {visible && state.phase === "plot-choice" && (
            <section>
              <span className="eyebrow">Plot revealed</span>
              <h2>Choose your allegiance</h2>
              <p>
                {targetPlayer}, choose one virtual follower for final scoring.
                The court and supply stay unchanged.
              </p>
              {FACTIONS.map((faction) => (
                <button
                  className="plot-choice-button"
                  key={faction}
                  onClick={() =>
                    safely(() =>
                      accept(
                        choosePlot(session, {
                          playerId: targetPlayer,
                          faction,
                          baseEventSequence: state.eventSequence,
                        }),
                      ),
                    )
                  }
                >
                  Support {title(faction)}
                </button>
              ))}
            </section>
          )}
          {visible && draft && preview && (
            <>
              <div className="section-title">
                <h2>Your hand</h2>
                <button className="quiet" onClick={() => setRevealed(null)}>
                  Hide hand
                </button>
              </div>
              <p className="hint">
                Choose one card, or pass. Cards are spent only at End Turn.
              </p>
              <div className="hand">
                {table.hand.map((card, index) => (
                  <button
                    key={card.id}
                    className={`action-card ${selectedCard?.id === card.id ? "selected" : ""}`}
                    disabled={
                      !availableCards.some(
                        (available) => available.id === card.id,
                      )
                    }
                    aria-pressed={selectedCard?.id === card.id}
                    aria-label={`Play ${title(card.type)}${card.type === "assemble" ? ` ${table.hand.slice(0, index + 1).filter((item) => item.type === "assemble").length}` : ""}`}
                    onClick={() => safely(() => startCard(card.id))}
                  >
                    <span>{title(card.type)}</span>
                    <small>{CARD_TEXT[card.type]}</small>
                  </button>
                ))}
              </div>
              <button
                className={`pass-button ${selection?.kind === "pass" ? "selected" : ""}`}
                aria-pressed={selection?.kind === "pass"}
                onClick={() => {
                  setDraft(draftPass(draft));
                  setEffectChoice(null);
                  choiceOrigin.current = "panel";
                }}
              >
                Pass
              </button>
              {selectedCard && (
                <section className="choice-panel" aria-label="Card effect">
                  <span className="eyebrow">
                    1 · Resolve {title(selectedCard.type)}
                  </span>
                  {selection?.kind === "card" &&
                    selection.effect === null &&
                    effectChoice &&
                    decision && (
                      <>
                        <h3>{decision.label}</h3>
                        <p className="hint">
                          {decision.options[0]?.kind === "follower"
                            ? "Click a highlighted follower on the board, or choose below. Click the same faction again to select a second follower."
                            : "Click a highlighted region/card, or choose below."}
                        </p>
                        {effectChoice.picks.length > 0 && (
                          <p className="picked-targets">
                            Selected:{" "}
                            {effectChoice.picks
                              .map((pick) => pick.label)
                              .join(" → ")}
                          </p>
                        )}
                        <div className="choices" key={decision.key}>
                          {decision.options.map((option) => (
                            <button
                              key={option.key}
                              onClick={() => selectValue(option.key)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        {effectChoice.picks.length > 0 && (
                          <button
                            className="quiet"
                            onClick={() => {
                              choiceOrigin.current = "panel";
                              setEffectChoice(undoEffectPick(effectChoice));
                            }}
                          >
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
                      The two return followers can be the same or different
                      factions. A legal 1-for-2 swap is required whenever
                      possible anywhere; otherwise the engine offers 1-for-1.
                    </p>
                  )}
                  <button
                    className="quiet"
                    onClick={() => startCard(selectedCard.id)}
                  >
                    Restart effect choices
                  </button>
                </section>
              )}
              {preview.step === "choose-summon" && (
                <section
                  className="choice-panel"
                  aria-label="Summon a follower"
                >
                  <span className="eyebrow">2 · Grow your court</span>
                  <h3>Summon one follower</h3>
                  <p className="hint">
                    Click a highlighted follower on the board, or choose below.
                    The board shows your card’s effect.
                  </p>
                  <div className="summon-choices">
                    {preview.summonChoices.map((summon, index) => (
                      <button
                        key={index}
                        onClick={() => {
                          choiceOrigin.current = "panel";
                          setDraft(draftSummon(draft, summon));
                        }}
                      >
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
                </section>
              )}
              {preview.plan && (
                <section
                  className="plan-summary"
                  aria-label="Final turn summary"
                  tabIndex={-1}
                >
                  <span className="eyebrow">Ready to commit</span>
                  <h3>
                    {preview.plan.kind === "pass"
                      ? "Pass this turn"
                      : `Play ${selectedCard ? title(selectedCard.type) : "card"}`}
                  </h3>
                  {preview.plan.kind === "pass" ? (
                    <p>
                      {state.consecutivePasses + 1 === state.playerOrder.length
                        ? "This completes the pass round and resolves the next power struggle."
                        : "One more consecutive pass. No follower is summoned."}
                    </p>
                  ) : (
                    <>
                      <p>{describeEffect(preview.plan.effect)}</p>
                      <p>
                        {preview.plan.summon.kind === "zero"
                          ? "Summon zero: no followers remain in uncontrolled regions."
                          : `Summon 1 ${title(preview.plan.summon.faction)} from ${title(preview.plan.summon.regionId)}.`}
                      </p>
                    </>
                  )}
                  <p className="hint">
                    End Turn commits this choice and hands over the device.
                  </p>
                </section>
              )}
              {selection?.kind === "card" && selection.effect !== null && (
                <p className="preview-badge" role="status">
                  Preview shown on board and courts · not committed
                </p>
              )}
              <div className="commit-bar">
                <button
                  onClick={() => {
                    setDraft(resetTurn(state, draft));
                    setEffectChoice(null);
                    choiceOrigin.current = "panel";
                    setError(null);
                  }}
                >
                  Reset Turn
                </button>
                <button
                  className="primary"
                  disabled={preview.plan === null}
                  onClick={() => safely(() => accept(endTurn(session, draft)))}
                >
                  End Turn
                </button>
              </div>
              <details className="committed-info">
                <summary>Committed position</summary>
                <p>
                  Turn {committed.turn}; {committed.passes} consecutive passes.
                  Your court before this draft:
                </p>
                <Followers
                  counts={
                    committed.players.find(
                      (player) => player.id === targetPlayer,
                    )!.court
                  }
                  label="Committed court"
                />
              </details>
            </>
          )}
          {state.phase === "finished" && (
            <section className="privacy-panel">
              <span aria-hidden="true" className="privacy-symbol">
                ♜
              </span>
              <h2>Game complete</h2>
              <p>
                Open the result explanation to see the court comparisons and
                tiebreaks.
              </p>
            </section>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
