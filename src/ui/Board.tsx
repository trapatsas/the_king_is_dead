import { BOARD_EDGES } from "../game/board";
import { FACTIONS, REGION_IDS } from "../game/domain";
import type { FactionCounts, RegionId } from "../game/domain";
import { FACTION_MARKS, title } from "./presentation";
import type { TableView } from "./presentation";

const POSITIONS: Record<RegionId, readonly [number, number]> = {
  moray: [49, 9],
  strathclyde: [36, 29],
  northumbria: [68, 41],
  lancaster: [30, 49],
  gwynedd: [17, 70],
  warwick: [49, 69],
  essex: [80, 76],
  devon: [37, 91],
};

export function Followers({
  counts,
  label,
}: {
  counts: FactionCounts;
  label: string;
}) {
  return (
    <span className="followers" aria-label={label}>
      {FACTIONS.map((faction) => (
        <span
          className={`follower ${faction}`}
          key={faction}
          aria-label={`${title(faction)} ${counts[faction]}`}
        >
          <span aria-hidden="true">{FACTION_MARKS[faction]}</span>{" "}
          {counts[faction]}
        </span>
      ))}
    </span>
  );
}

export function Board({
  table,
  choices,
  onRegion,
}: {
  table: TableView;
  choices: readonly RegionId[];
  onRegion: ((region: RegionId) => void) | null;
}) {
  const pending = table.regionCards.find((card) => card.faceUp)?.regionId;
  return (
    <section className="map-panel" aria-label="Britain and its borders">
      <div className="section-title">
        <div>
          <span className="eyebrow">A kingdom divided</span>
          <h2>Britain</h2>
        </div>
        <span className="map-key">Lines show the 13 borders</span>
      </div>
      <div className="map">
        <svg
          className="borders"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-label="Thirteen region connections"
          role="img"
        >
          <desc>
            {BOARD_EDGES.map(
              ([first, second]) =>
                `${title(first)} connects to ${title(second)}`,
            ).join("; ")}
          </desc>
          <path
            className="coast"
            d="M44 2 63 4 69 14 54 23 65 30 78 33 81 50 92 65 96 86 73 91 55 96 25 98 9 91 14 79 3 75 8 61 21 58 20 42 27 34 24 23 37 21 35 10Z"
          />
          {BOARD_EDGES.map(([first, second]) => (
            <line
              key={`${first}-${second}`}
              x1={POSITIONS[first][0]}
              y1={POSITIONS[first][1]}
              x2={POSITIONS[second][0]}
              y2={POSITIONS[second][1]}
            />
          ))}
        </svg>
        <span className="sea-label">THE WESTERN SEA</span>
        {REGION_IDS.map((id) => {
          const region = table.regions[id];
          const eligible = choices.includes(id);
          const control =
            region.control.kind === "faction"
              ? `${title(region.control.faction)} control`
              : region.control.kind === "unstable"
                ? "Unstable"
                : "Uncontrolled";
          return (
            <button
              key={id}
              className={`region ${eligible ? "eligible" : ""} ${pending === id ? "pending" : ""}`}
              style={{
                left: `${POSITIONS[id][0]}%`,
                top: `${POSITIONS[id][1]}%`,
              }}
              disabled={onRegion === null || !eligible}
              onClick={() => onRegion?.(id)}
              aria-label={`${title(id)}: ${control}; ${FACTIONS.map((faction) => `${title(faction)} ${region.followers[faction]}`).join(", ")}${eligible ? ", legal choice" : ""}`}
            >
              <strong>{title(id)}</strong>
              {region.control.kind === "unresolved" ? (
                <Followers
                  counts={region.followers}
                  label={`${title(id)} followers`}
                />
              ) : (
                <span
                  className={`region-control ${region.control.kind === "faction" ? region.control.faction : ""}`}
                >
                  {control}
                </span>
              )}
            </button>
          );
        })}
        <span className="compass" aria-hidden="true">
          N<br />↑
        </span>
      </div>
      <div className="map-caption">
        <span className="pending-dot" /> Next struggle:{" "}
        {pending ? title(pending) : "all regions resolved"}.{" "}
        {choices.length > 0
          ? "Highlighted regions are legal choices."
          : "Choose an action to see legal targets."}
      </div>
    </section>
  );
}

export function RegionTrack({
  table,
  choices,
  onRegion,
}: {
  table: TableView;
  choices: readonly RegionId[];
  onRegion: ((region: RegionId) => void) | null;
}) {
  return (
    <section className="track-panel" aria-label="Power struggle order">
      <div className="section-title">
        <h2>Power struggles</h2>
        <span>Resolve from left to right · click to choose, never drag</span>
      </div>
      <ol className="region-track">
        {table.regionCards.map((card) => (
          <li key={card.slot}>
            <button
              className={`track-card ${!card.faceUp ? "resolved" : ""} ${choices.includes(card.regionId) ? "eligible" : ""}`}
              disabled={onRegion === null || !choices.includes(card.regionId)}
              onClick={() => onRegion?.(card.regionId)}
              aria-label={`Slot ${card.slot}: ${title(card.regionId)}${!card.faceUp ? ", resolved" : ""}${card.negotiationDiscOwner ? `, marked by ${card.negotiationDiscOwner}` : ""}`}
            >
              <span className="slot-number">
                {String(card.slot).padStart(2, "0")}
              </span>
              <strong>{title(card.regionId)}</strong>
              <small>
                {card.negotiationDiscOwner
                  ? `● ${card.negotiationDiscOwner}`
                  : card.faceUp
                    ? "Unresolved"
                    : "Resolved"}
              </small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
