import { useEffect, useRef, useState } from "react";
import { witnessedCards } from "../app/botObservation";
import { rememberBotTelemetry } from "../app/botTelemetry";
import { commitPlan } from "../app/session";
import { BotClient } from "../bot/client";
import type { GameSession } from "../game/events";
import { getObservation } from "../game/visibility";

export function useBotTurn(
  session: GameSession,
  accept: (next: GameSession) => void,
) {
  const client = useRef<BotClient | null>(null);
  const acceptRef = useRef(accept);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { state } = session;
  const active =
    state.phase === "turn" &&
    state.players[state.activePlayerId]?.controller === "algorithmic";
  useEffect(() => {
    acceptRef.current = accept;
  });
  useEffect(
    () => () => {
      client.current?.dispose();
      client.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    setError(null);
    async function choose() {
      try {
        client.current ??= new BotClient();
        if (state.players[state.activePlayerId]?.botStrategy === "ml") {
          setLoading(true);
          await client.current.prepare(abort.signal);
          if (abort.signal.aborted) return;
          setLoading(false);
        }
        const result = await client.current.search(
          {
            observation: getObservation(state, state.activePlayerId),
            memory: witnessedCards(session),
            budget: {
              iterations: 1024,
              timeMs: 1400,
              seed:
                state.turnSequence * 7919 +
                state.playerOrder.indexOf(state.activePlayerId) +
                1,
            },
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        if (
          result.plan.playerId !== state.activePlayerId ||
          result.plan.baseTurnSequence !== state.turnSequence
        )
          throw new Error("Stale bot turn");
        // Public validation/commit only. No preview or proposed move enters history.
        const next = commitPlan(session, result.plan);
        rememberBotTelemetry(next, {
          result,
          runtime: "browser",
          budget: {
            iterations: 1024,
            timeMs: 1400,
            seed:
              state.turnSequence * 7919 +
              state.playerOrder.indexOf(state.activePlayerId) +
              1,
          },
        });
        acceptRef.current(next);
      } catch {
        if (!abort.signal.aborted) {
          setLoading(false);
          setError("The bot could not complete this turn. Try again.");
        }
      }
    }
    void choose();
    return () => abort.abort();
  }, [session, state, active, retry]);
  return {
    active,
    loading,
    strategy: state.players[state.activePlayerId]?.botStrategy ?? "reference",
    error,
    retry: () => setRetry((n) => n + 1),
  };
}
