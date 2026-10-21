import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameRepository } from "./repository";
import type { BotProvenance } from "./repository";
import type { SetupConfig } from "../game/domain";
import type { BotTelemetry } from "../app/botTelemetry";
import type { TurnPlan } from "../game/turnTypes";
import { getObservation } from "../game/visibility";
import { projectPublicLog } from "../ui/finishedLog";
import { DEFAULT_INFORMED_PARAMS } from "../bot/informed";

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON required");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 128 * 1024) throw new Error("Request too large");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid request");
  return input as Record<string, unknown>;
}

export function gameApi(repo: GameRepository) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(data));
    };
    try {
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      ) {
        send(403, { error: "Origin rejected" });
        return;
      }
      if (url.pathname === "/api/storage" && req.method === "GET") {
        send(200, { available: true, schemaVersion: 2 });
        return;
      }
      if (url.pathname === "/api/games" && req.method === "POST") {
        const input = await body(req);
        const config = input.config as SetupConfig;
        if (!Array.isArray(config?.players)) throw new Error("Invalid setup");
        const bots: Record<string, BotProvenance> = {};
        for (const p of config.players) {
          if (p.botStrategy === "informed")
            bots[p.id] = {
              version: "informed-mcts-v1",
              params: {
                ...DEFAULT_INFORMED_PARAMS,
                iterations: 1024,
                timeMs: 1400,
              },
            };
          if (p.botStrategy === "ml") {
            const manifest = JSON.parse(
              readFileSync(
                resolve("public/models/pilot/manifest.json"),
                "utf8",
              ),
            );
            bots[p.id] = {
              version: "ml-mcts-v1",
              params: {
                modelId: manifest.modelId,
                modelHash: manifest.weightsSha256,
                learnedWeight: manifest.learnedWeight,
                iterations: 1024,
                timeMs: 1400,
              },
            };
          }
        }
        const session = repo.create(String(input.id), config, {
          source: "live",
          bots,
        });
        send(200, { eventSequence: session.state.eventSequence });
        return;
      }
      const match = /^\/api\/games\/(king-[a-f0-9-]{36})(\/commands)?$/.exec(
        url.pathname,
      );
      if (match && match[2] && req.method === "POST") {
        const input = await body(req);
        const session = repo.append(
          match[1]!,
          String(input.requestId),
          Number(input.baseEventSequence),
          input.plan as TurnPlan,
          input.decision as BotTelemetry | undefined,
        );
        // Feature materialization is an offline command; it never delays a live save.
        send(200, { eventSequence: session.state.eventSequence });
        return;
      }
      if (match && !match[2] && req.method === "GET") {
        const session = repo.session(match[1]!);
        send(200, {
          observation: getObservation(session.state, null),
          entries: projectPublicLog(session),
        });
        return;
      }
      send(404, { error: "Unknown API route" });
    } catch {
      // Rule/invariant errors may contain private state. Keep transport errors generic.
      send(409, {
        error: "The game could not be saved. Retry the pending save.",
      });
    }
  };
}

/** Called by the same-origin development / local-preview adapter. */
export function openStorage() {
  const repo = new GameRepository(
    process.env.KING_DB_PATH ?? ".data/king.sqlite",
  );
  return { handler: gameApi(repo), close: () => repo.close() };
}
