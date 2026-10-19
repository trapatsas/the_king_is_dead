import { describe, expect, it } from "vitest";
import { pass, setupSession } from "../test/turnFixtures";
import { play } from "../test/standardFixtures";
import { getObservation } from "./visibility";

const serialized = (value: unknown): string => JSON.stringify(value);

describe("per-seat observations", () => {
  it("shows the viewer's own hand and only the size of every other hand", () => {
    const { state } = setupSession(3);
    const observation = getObservation(state, "p1");
    expect(observation.own?.hand).toEqual(state.players.p1!.hand);
    expect(observation.players.map((player) => player.handCount)).toEqual([
      8, 8, 8,
    ]);
    const text = serialized(observation);
    expect(text).not.toContain("standard:p2:");
    expect(text).not.toContain("standard:p3:");
  });

  it("gives a public (handoff) view no private cards at all", () => {
    const { state } = setupSession(2);
    const observation = getObservation(state, null);
    expect(observation.own).toBeNull();
    expect(serialized(observation)).not.toMatch(/standard:p[12]:/);
  });

  it("hides other Advanced hands, undealt Cunning cards, the seed and RNG cursors", () => {
    const { state } = setupSession(3, "advanced", "secret-seed");
    const observation = getObservation(state, "p2");
    const text = serialized(observation);
    for (const id of ["p1", "p3"]) {
      for (const card of state.players[id]!.hand)
        expect(text).not.toContain(`"${card.id}"`);
    }
    for (const card of state.undealtCunningCards)
      expect(text).not.toContain(`"${card.id}"`);
    expect(text).not.toContain("secret-seed");
    expect(observation.seed).toBeNull();
    expect(observation).not.toHaveProperty("rngState");
    expect(observation).not.toHaveProperty("initialRngState");
    expect(observation).not.toHaveProperty("undealtCunningCards");
  });

  it("shows only the top of other discard piles but the viewer's whole pile", () => {
    let session = setupSession(3);
    for (let action = 0; action < 6; action += 1)
      session = play(session, "assemble");
    const { state } = session;
    const observation = getObservation(state, "p1");
    for (const view of observation.players) {
      const discards = state.players[view.id]!.discards;
      expect(view.discardCount).toBe(2);
      expect(view.discardTop).toEqual(discards.at(-1));
    }
    expect(observation.own?.discards).toEqual(state.players.p1!.discards);
    const text = serialized(observation);
    for (const id of ["p2", "p3"])
      expect(text).not.toContain(`"${state.players[id]!.discards[0]!.id}"`);
  });

  it("discloses the seed once the game is finished", () => {
    let session = setupSession(2, "standard", "reveal-later");
    while (session.state.phase === "turn") session = pass(session);
    expect(session.state.phase).toBe("finished");
    expect(getObservation(session.state, null).seed).toBe("reveal-later");
  });

  it("returns a frozen copy that shares no references with engine state", () => {
    const { state } = setupSession(3);
    const observation = getObservation(state, "p1");
    expect(Object.isFrozen(observation)).toBe(true);
    expect(observation.regions).not.toBe(state.regions);
    expect(observation.own?.hand).not.toBe(state.players.p1!.hand);
    expect(() => getObservation(state, "p9")).toThrow(/Unknown observing/);
  });
});
