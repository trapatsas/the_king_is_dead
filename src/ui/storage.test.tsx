// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSession } from "../test/turnFixtures";
import { App } from "./App";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
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
  it("keeps save progress in the header and preserves the table during a turn save", async () => {
    const user = userEvent.setup();
    const acknowledgement = () =>
      new Response(JSON.stringify({ eventSequence: 1000 }), {
        headers: { "Content-Type": "application/json" },
      });
    let acknowledgeTurn!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(acknowledgement())
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              acknowledgeTurn = resolve;
            }),
        ),
    );
    render(<App initialSession={setupSession(2)} />);
    const status = screen.getByRole("status", { name: "Game save status" });
    await act(async () => {});
    expect(status.textContent).toBe("Saved");
    const table = screen.getByRole("main");
    await user.click(screen.getByRole("button", { name: "Pass" }));
    await user.click(screen.getByRole("button", { name: "End Turn" }));
    expect(status.textContent).toBe("Saving…");
    expect(screen.getByRole("banner").contains(status)).toBe(true);
    expect(screen.queryByText("Saving game…")).toBeNull();
    expect(screen.getByRole("main")).toBe(table);
    await act(async () => acknowledgeTurn(acknowledgement()));
    expect(status.textContent).toBe("Saved");
    expect(screen.getByRole("main")).toBe(table);
    expect(outboxKeys()).toHaveLength(0);
  });
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
