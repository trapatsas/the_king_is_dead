import { BOARD_EDGES } from "../game/board";
import { FACTIONS, REGION_IDS } from "../game/domain";
import type { FactionCounts, RegionId } from "../game/domain";
import { forecast, leaderClass, regionLeader, title } from "./presentation";
import type { TableView } from "./presentation";
import type { FollowerPick } from "./effectChoices";

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

/** Faction counts as shape-coded marks (● Scottish, ■ Welsh, ◆ English) so
 * colour is never the only cue. */
export function Followers({
  counts,
  label,
}: {
  counts: FactionCounts;
  label: string;
}) {
  return (
    <span className="followers" role="group" aria-label={label}>
      {FACTIONS.map((faction) => (
        <span
          className={`follower ${faction} ${counts[faction] === 0 ? "is-zero" : ""}`}
          key={faction}
          role="img"
          aria-label={`${title(faction)} ${counts[faction]}`}
        >
          <span className={`mark ${faction}`} aria-hidden="true" />
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
  followerChoices,
  onFollower,
  selectedFollowers,
  instruction,
}: {
  table: TableView;
  choices: readonly RegionId[];
  onRegion: ((region: RegionId) => void) | null;
  followerChoices: readonly FollowerPick[];
  onFollower: ((pick: FollowerPick) => void) | null;
  selectedFollowers: readonly FollowerPick[];
  instruction: string | null;
}) {
  const pending = table.regionCards.find((card) => card.faceUp)?.regionId;
  const choosing = choices.length > 0 || followerChoices.length > 0;
  return (
    <section
      className={`map-panel ${choosing ? "is-choosing" : ""}`}
      aria-label="Britain and its borders"
    >
      <h2 className="sr-only">Britain</h2>
      <div className="map-frame">
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
          <span className="sea-label" aria-hidden="true">
            The Western Sea
          </span>
          {REGION_IDS.map((id) => {
            const region = table.regions[id];
            const slot = table.regionCards.find(
              (card) => card.regionId === id,
            )!;
            const eligible = choices.includes(id);
            const followerEligible = followerChoices.some(
              (pick) => pick.regionId === id,
            );
            const open = region.control.kind === "unresolved";
            const control =
              region.control.kind === "faction"
                ? `${title(region.control.faction)} control`
                : region.control.kind === "unstable"
                  ? "Unstable"
                  : "Uncontrolled";
            const lead = open
              ? leaderClass(regionLeader(region.followers))
              : region.control.kind === "faction"
                ? region.control.faction
                : "unstable";
            return (
              <div
                key={id}
                className={[
                  "region",
                  `lead-${lead}`,
                  eligible || followerEligible ? "eligible" : "",
                  choosing && !eligible && !followerEligible ? "dimmed" : "",
                  pending === id ? "pending" : "",
                  open ? "" : "resolved",
                ].join(" ")}
                style={{
                  left: `${POSITIONS[id][0]}%`,
                  top: `${POSITIONS[id][1]}%`,
                }}
                role="group"
                aria-label={`${title(id)} region`}
              >
                <button
                  className="region-target"
                  disabled={onRegion === null || !eligible}
                  onClick={() => onRegion?.(id)}
                  aria-label={`${title(id)}: ${control}; ${FACTIONS.map((faction) => `${title(faction)} ${region.followers[faction]}`).join(", ")}${eligible ? ", legal choice" : ""}`}
                >
                  <span
                    className="region-order"
                    aria-hidden="true"
                    title={`Power struggle ${slot.slot}`}
                  >
                    {slot.slot}
                  </span>
                  <strong>{title(id)}</strong>
                  {slot.negotiationDiscOwner && (
                    <span
                      className="disc-marker"
                      aria-hidden="true"
                      title={`Negotiation disc: ${slot.negotiationDiscOwner}`}
                    />
                  )}
                </button>
                {open ? (
                  <span
                    className="followers region-followers"
                    role="group"
                    aria-label={`${title(id)} followers`}
                  >
                    {FACTIONS.map((faction) => {
                      const count = region.followers[faction];
                      const allowed = followerChoices.some(
                        (pick) =>
                          pick.regionId === id && pick.faction === faction,
                      );
                      const selected = selectedFollowers.filter(
                        (pick) =>
                          pick.regionId === id && pick.faction === faction,
                      ).length;
                      return (
                        <button
                          key={faction}
                          className={`follower follower-token ${faction} ${count === 0 ? "is-zero" : ""} ${allowed ? "follower-eligible" : ""} ${selected ? "follower-selected" : ""}`}
                          disabled={onFollower === null || !allowed}
                          onClick={() =>
                            onFollower?.({ regionId: id, faction })
                          }
                          aria-label={
                            allowed && onFollower !== null
                              ? `Select ${title(faction)} follower in ${title(id)} (${count} available${selected ? `, ${selected} selected` : ""})`
                              : `${title(faction)} followers in ${title(id)}: ${count}${selected ? `, ${selected} selected` : ""}`
                          }
                          title={`${title(faction)} followers: ${count}`}
                        >
                          <span
                            className={`mark ${faction}`}
                            aria-hidden="true"
                          />
                          <span className="follower-amount" aria-hidden="true">
                            {count}
                          </span>
                          {selected > 0 && (
                            <span
                              className="follower-selection-count"
                              aria-hidden="true"
                            >
                              {selected}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </span>
                ) : (
                  <span
                    className={`region-control ${region.control.kind === "faction" ? region.control.faction : "unstable"}`}
                  >
                    {region.control.kind === "faction" ? (
                      <>
                        <span
                          className={`mark ${region.control.faction}`}
                          aria-hidden="true"
                        />
                        {title(region.control.faction)}
                        <span className="sr-only"> control</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">✕</span>
                        {control}
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}
          <span className="compass" aria-hidden="true">
            N
          </span>
        </div>
      </div>
      {instruction ? (
        <p className="map-caption map-hint" aria-hidden="true">
          <span className="hint-arrow">▸</span>
          <span>
            <strong>{instruction}</strong>
            {followerChoices.length
              ? " · select a highlighted follower"
              : choices.length
                ? " · select a highlighted region"
                : ""}
          </span>
        </p>
      ) : (
        <p className="map-caption">
          <span className="pending-dot" aria-hidden="true" />
          {pending ? (
            <span>
              Next struggle: <strong>{title(pending)}</strong> ·{" "}
              {forecast(regionLeader(table.regions[pending].followers))}
            </span>
          ) : (
            "All regions resolved"
          )}
        </p>
      )}
    </section>
  );
}

const ABBREVIATIONS: Record<RegionId, string> = {
  moray: "Mor",
  strathclyde: "Str",
  northumbria: "Nor",
  lancaster: "Lan",
  gwynedd: "Gwy",
  warwick: "War",
  essex: "Ess",
  devon: "Dev",
};

export function RegionTrack({
  table,
  choices,
  onRegion,
  selectedRegions,
}: {
  table: TableView;
  choices: readonly RegionId[];
  onRegion: ((region: RegionId) => void) | null;
  selectedRegions: readonly RegionId[];
}) {
  const next = table.regionCards.find((card) => card.faceUp)?.slot;
  return (
    <section className="track-panel" aria-label="Power struggle order">
      <h2 className="sr-only">Power struggles</h2>
      <ol className="region-track">
        {table.regionCards.map((card) => {
          const region = table.regions[card.regionId];
          const leader = regionLeader(region.followers);
          const outcome =
            region.control.kind === "faction"
              ? region.control.faction
              : region.control.kind === "unstable"
                ? "unstable"
                : null;
          return (
            <li key={card.slot}>
              <button
                className={[
                  "track-card",
                  !card.faceUp ? "resolved" : "",
                  outcome ? `won-${outcome}` : "",
                  card.slot === next ? "next" : "",
                  choices.includes(card.regionId) ? "eligible" : "",
                  selectedRegions.includes(card.regionId)
                    ? "chosen-region"
                    : "",
                ].join(" ")}
                disabled={onRegion === null || !choices.includes(card.regionId)}
                onClick={() => onRegion?.(card.regionId)}
                aria-label={`Slot ${card.slot}: ${title(card.regionId)}${!card.faceUp ? ", resolved" : ""}${card.negotiationDiscOwner ? `, marked by ${card.negotiationDiscOwner}` : ""}`}
                title={
                  card.faceUp
                    ? `${title(card.regionId)} · ${forecast(leader)}`
                    : undefined
                }
              >
                <span className="track-top">
                  <span className="slot-number">{card.slot}</span>
                  <small>
                    {outcome ? (
                      <>
                        {outcome === "unstable" ? (
                          <span aria-hidden="true">✕</span>
                        ) : (
                          <span
                            className={`mark ${outcome}`}
                            aria-hidden="true"
                          />
                        )}
                        <span className="status-text">{title(outcome)}</span>
                      </>
                    ) : (
                      card.slot === next && (
                        <>
                          <span
                            className={`mark ${leaderClass(leader)}`}
                            aria-hidden="true"
                          />
                          <span className="status-text">Next</span>
                        </>
                      )
                    )}
                    {card.negotiationDiscOwner && (
                      <span
                        className="disc-marker"
                        aria-hidden="true"
                        title={`Negotiation disc: ${card.negotiationDiscOwner}`}
                      />
                    )}
                  </small>
                </span>
                <strong>
                  <span className="name-full">{title(card.regionId)}</span>
                  <span className="name-short" aria-hidden="true">
                    {ABBREVIATIONS[card.regionId]}
                  </span>
                </strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
