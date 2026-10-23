import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { argumentsOf, runtime } from "./ml/runtime.mjs";

const args = argumentsOf(process.argv.slice(2));
for (const key of Object.keys(args))
  if (!["db", "game", "origin"].includes(key))
    throw new Error(`Unknown option --${key}`);
const path = resolve(
  args.db ?? process.env.KING_DB_PATH ?? ".data/king.sqlite",
);
const origin = new URL(args.origin ?? "http://localhost:5173");
if (!["http:", "https:"].includes(origin.protocol))
  throw new Error("Invalid app origin");
const db = new DatabaseSync(path, { readOnly: true });
let rt;
try {
  const row = db
    .prepare(
      "SELECT public_id FROM games WHERE public_id=? AND mode='standard' AND source='live' AND status='in_progress'",
    )
    .get(args.game ?? "");
  if (!row) throw new Error("Choose an unfinished live Standard game");
  rt = await runtime();
  const access = new rt.resumeAccess.ResumeAccess(
    resolve(dirname(path), "resume-access"),
  );
  const token = access.issue(String(row.public_id));
  console.log(`${origin.origin}/#resume=${token}`);
} finally {
  db.close();
  await rt?.close();
}
