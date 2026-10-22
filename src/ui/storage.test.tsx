// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSession } from "../test/turnFixtures";
import { App } from "./App";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});
function recoveredRequest() {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("API unavailable"))
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ eventSequence: 0 }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
  vi.stubGlobal("fetch", request);
  return request;
}
function outboxKeys() {
  return Object.keys(localStorage).filter((key) =>
    key.startsWith("king:sqlite-outbox:"),
  );
}
describe("automatic game-save recovery", () => {
  it("retries pending saves after a local server restart without a refresh", async () => {
    vi.useFakeTimers();
    const request = recoveredRequest();
    render(<App initialSession={setupSession(2)} />);
    await act(async () => {});
    expect(screen.getByText(/Some game saves are pending/)).toBeDefined();
    expect(outboxKeys()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Some game saves are pending/)).toBeNull();
    expect(outboxKeys()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Pass" })).toBeDefined();
  });
  it.each(["online", "focus"])(
    "retries immediately on the browser %s event",
    async (event) => {
      const request = recoveredRequest();
      render(<App initialSession={setupSession(2)} />);
      await screen.findByText(/Some game saves are pending/);
      await act(async () => {
        window.dispatchEvent(new Event(event));
      });
      expect(request).toHaveBeenCalledTimes(2);
      expect(outboxKeys()).toHaveLength(0);
      expect(screen.queryByText(/Some game saves are pending/)).toBeNull();
    },
  );
});
