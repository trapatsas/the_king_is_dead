-- PROPOSAL: private server-side storage, not a public log export.
-- Requires SQLite >= 3.38 with JSON functions and STRICT tables enabled.
-- Run once through a migration runner; intentionally not IF NOT EXISTS.
-- Connection configuration (foreign_keys/busy_timeout/synchronous) must also
-- be applied by the application on every writable connection, before BEGIN.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

BEGIN IMMEDIATE;

CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0),
    checksum TEXT NOT NULL
) STRICT;

CREATE TABLE regions (
    region_id TEXT PRIMARY KEY
) STRICT;
INSERT INTO regions(region_id) VALUES
    ('moray'), ('strathclyde'), ('lancaster'), ('northumbria'),
    ('gwynedd'), ('warwick'), ('essex'), ('devon');

CREATE TABLE card_types (
    card_type TEXT PRIMARY KEY
) STRICT;
INSERT INTO card_types(card_type) VALUES
    ('scottish-support'), ('welsh-support'), ('english-support'),
    ('negotiate'), ('manoeuvre'), ('outmanoeuvre'), ('assemble'),
    ('spy'), ('ambush'), ('march'), ('plot'), ('aid'), ('influence'),
    ('dispute'), ('edict'), ('resist'), ('quell'), ('suppress'), ('muster');

CREATE TABLE bot_configs (
    id INTEGER PRIMARY KEY,
    strategy TEXT NOT NULL,
    version TEXT NOT NULL,
    code_revision TEXT,
    params_json TEXT NOT NULL CHECK (json_valid(params_json) AND json_type(params_json) = 'object'),
    -- SHA-256 of canonical {strategy, version, code_revision, resolved params}.
    config_hash TEXT NOT NULL UNIQUE CHECK (length(config_hash) = 64)
) STRICT;

CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('standard', 'advanced')),
    rules_version TEXT NOT NULL,
    state_schema_version INTEGER NOT NULL CHECK (state_schema_version > 0),
    app_revision TEXT,
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'finished', 'abandoned')),
    player_count INTEGER NOT NULL CHECK (player_count IN (2, 3)),
    starting_seat INTEGER NOT NULL CHECK (starting_seat BETWEEN 0 AND 2),
    source TEXT NOT NULL CHECK (source IN ('live', 'benchmark', 'import')),
    -- E.g. informed-heldout-v1; keep tuning and held-out datasets separate.
    dataset TEXT,
    -- Shared by seat rotations of the same accepted setup; not a human name.
    setup_group TEXT,
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    finished_at_ms INTEGER,
    last_event_seq INTEGER NOT NULL CHECK (last_event_seq >= 0),
    last_turn_seq INTEGER NOT NULL CHECK (last_turn_seq >= 0),
    last_action_seq INTEGER NOT NULL CHECK (last_action_seq >= 0 AND last_action_seq <= last_turn_seq),
    CHECK ((status = 'finished' AND finished_at_ms IS NOT NULL AND finished_at_ms >= created_at_ms)
        OR (status <> 'finished' AND finished_at_ms IS NULL)),
    FOREIGN KEY (id, starting_seat) REFERENCES game_players(game_id, seat)
        DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE game_players (
    game_id INTEGER NOT NULL REFERENCES games(id),
    -- Immutable clockwise seat, independent of starting player and display name.
    seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 2),
    engine_player_id TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
    controller TEXT NOT NULL CHECK (controller IN ('human', 'algorithmic', 'llm')),
    bot_config_id INTEGER REFERENCES bot_configs(id),
    -- Optional stable account ID; two people named Panos are not one identity.
    account_id TEXT,
    CHECK (controller = 'algorithmic' OR bot_config_id IS NULL),
    PRIMARY KEY (game_id, seat),
    UNIQUE (game_id, engine_player_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_events (
    game_id INTEGER NOT NULL REFERENCES games(id),
    event_seq INTEGER NOT NULL CHECK (event_seq >= 0),
    turn_seq INTEGER NOT NULL CHECK (turn_seq >= 0),
    action_seq INTEGER NOT NULL CHECK (action_seq >= 0 AND action_seq <= turn_seq),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'GameCreated', 'TurnCommitted', 'PowerStruggleResolved',
        'GameEndTriggered', 'PlotRevealed', 'PlotChosen', 'GameFinished'
    )),
    actor_seat INTEGER,
    recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
    payload_version INTEGER NOT NULL CHECK (payload_version > 0),
    -- Original accepted engine event. GameCreated contains private state/RNG.
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
    CHECK ((event_type = 'GameCreated' AND event_seq = 0 AND turn_seq = 0 AND action_seq = 0 AND actor_seat IS NULL)
        OR (event_type <> 'GameCreated' AND event_seq > 0 AND actor_seat IS NOT NULL)),
    PRIMARY KEY (game_id, event_seq),
    FOREIGN KEY (game_id, actor_seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_commands (
    game_id INTEGER NOT NULL REFERENCES games(id),
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    -- -1 for creation. Later commands must match the game's persisted cursor.
    base_event_seq INTEGER NOT NULL CHECK (base_event_seq >= -1),
    last_event_seq INTEGER NOT NULL CHECK (last_event_seq > base_event_seq),
    PRIMARY KEY (game_id, request_id),
    UNIQUE (game_id, base_event_seq),
    FOREIGN KEY (game_id, last_event_seq) REFERENCES game_events(game_id, event_seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE turns (
    game_id INTEGER NOT NULL,
    turn_seq INTEGER NOT NULL CHECK (turn_seq > 0),
    event_seq INTEGER NOT NULL,
    actor_seat INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('pass', 'card')),
    -- NULL for passes; events retain the cumulative action clock for all events.
    action_seq INTEGER,
    card_instance_id TEXT,
    card_type TEXT REFERENCES card_types(card_type),
    effective_card TEXT REFERENCES card_types(card_type),
    effect_tier INTEGER,
    no_effect_reason TEXT,
    summon_kind TEXT CHECK (summon_kind IN ('follower', 'zero')),
    summon_region TEXT REFERENCES regions(region_id),
    summon_faction TEXT CHECK (summon_faction IN ('scottish', 'welsh', 'english')),
    CHECK ((kind = 'pass' AND action_seq IS NULL AND card_instance_id IS NULL
                AND card_type IS NULL AND effective_card IS NULL AND effect_tier IS NULL
                AND no_effect_reason IS NULL AND summon_kind IS NULL
                AND summon_region IS NULL AND summon_faction IS NULL)
        OR (kind = 'card' AND action_seq IS NOT NULL AND action_seq > 0 AND action_seq <= turn_seq
                AND card_instance_id IS NOT NULL AND card_type IS NOT NULL
                AND effective_card IS NOT NULL AND effect_tier IS NOT NULL AND effect_tier >= 0
                AND summon_kind IS NOT NULL)),
    CHECK (summon_kind IS NULL
        OR (summon_kind = 'zero' AND summon_region IS NULL AND summon_faction IS NULL)
        OR (summon_kind = 'follower' AND summon_region IS NOT NULL AND summon_faction IS NOT NULL)),
    PRIMARY KEY (game_id, turn_seq),
    UNIQUE (game_id, event_seq),
    UNIQUE (game_id, action_seq),
    UNIQUE (game_id, turn_seq, actor_seat),
    UNIQUE (game_id, card_instance_id),
    FOREIGN KEY (game_id, event_seq) REFERENCES game_events(game_id, event_seq),
    FOREIGN KEY (game_id, actor_seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

-- Effect transfers only. The independent mandatory summon is in turns above.
CREATE TABLE turn_transfers (
    game_id INTEGER NOT NULL,
    turn_seq INTEGER NOT NULL,
    operation_index INTEGER NOT NULL CHECK (operation_index >= 0),
    faction TEXT NOT NULL CHECK (faction IN ('scottish', 'welsh', 'english')),
    count INTEGER NOT NULL CHECK (count > 0),
    -- NULL denotes common supply; otherwise a region ID.
    from_region TEXT REFERENCES regions(region_id),
    to_region TEXT REFERENCES regions(region_id),
    CHECK (from_region IS NOT to_region),
    PRIMARY KEY (game_id, turn_seq, operation_index),
    FOREIGN KEY (game_id, turn_seq) REFERENCES turns(game_id, turn_seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE turn_region_swaps (
    game_id INTEGER NOT NULL,
    turn_seq INTEGER NOT NULL,
    operation_index INTEGER NOT NULL CHECK (operation_index >= 0),
    first_region TEXT NOT NULL REFERENCES regions(region_id),
    second_region TEXT NOT NULL REFERENCES regions(region_id),
    negotiation_disc_on TEXT REFERENCES regions(region_id),
    CHECK (first_region <> second_region),
    CHECK (negotiation_disc_on IS NULL OR negotiation_disc_on IN (first_region, second_region)),
    PRIMARY KEY (game_id, turn_seq, operation_index),
    FOREIGN KEY (game_id, turn_seq) REFERENCES turns(game_id, turn_seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE struggles (
    game_id INTEGER NOT NULL,
    struggle_index INTEGER NOT NULL CHECK (struggle_index BETWEEN 1 AND 8),
    event_seq INTEGER NOT NULL,
    turn_seq INTEGER NOT NULL,
    region TEXT NOT NULL REFERENCES regions(region_id),
    control_kind TEXT NOT NULL CHECK (control_kind IN ('faction', 'unstable')),
    faction TEXT CHECK (faction IN ('scottish', 'welsh', 'english')),
    -- returnedToSupply captures the board BEFORE followers are removed.
    scottish INTEGER NOT NULL CHECK (scottish >= 0),
    welsh INTEGER NOT NULL CHECK (welsh >= 0),
    english INTEGER NOT NULL CHECK (english >= 0),
    CHECK ((control_kind = 'faction' AND faction IS NOT NULL)
        OR (control_kind = 'unstable' AND faction IS NULL)),
    PRIMARY KEY (game_id, struggle_index),
    UNIQUE (game_id, event_seq),
    UNIQUE (game_id, region),
    FOREIGN KEY (game_id, event_seq) REFERENCES game_events(game_id, event_seq),
    FOREIGN KEY (game_id, turn_seq) REFERENCES turns(game_id, turn_seq)
) STRICT, WITHOUT ROWID;

-- A checkpoint is AFTER an entire accepted command's event batch, not after
-- an intermediate TurnCommitted event that may immediately trigger scoring.
CREATE TABLE game_snapshots (
    game_id INTEGER NOT NULL,
    event_seq INTEGER NOT NULL,
    turn_seq INTEGER NOT NULL CHECK (turn_seq >= 0),
    phase TEXT NOT NULL CHECK (phase IN ('turn', 'scoring', 'plot-choice', 'finished')),
    active_seat INTEGER NOT NULL,
    state_schema_version INTEGER NOT NULL CHECK (state_schema_version > 0),
    state_json TEXT NOT NULL CHECK (json_valid(state_json) AND json_type(state_json) = 'object'),
    PRIMARY KEY (game_id, event_seq),
    FOREIGN KEY (game_id, event_seq) REFERENCES game_events(game_id, event_seq),
    FOREIGN KEY (game_id, active_seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

CREATE TABLE player_snapshots (
    game_id INTEGER NOT NULL,
    event_seq INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    hand_count INTEGER NOT NULL CHECK (hand_count >= 0),
    scottish INTEGER NOT NULL CHECK (scottish >= 0),
    welsh INTEGER NOT NULL CHECK (welsh >= 0),
    english INTEGER NOT NULL CHECK (english >= 0),
    last_action_seq INTEGER CHECK (last_action_seq > 0),
    PRIMARY KEY (game_id, event_seq, seat),
    FOREIGN KEY (game_id, event_seq) REFERENCES game_snapshots(game_id, event_seq),
    FOREIGN KEY (game_id, seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

CREATE TABLE region_snapshots (
    game_id INTEGER NOT NULL,
    event_seq INTEGER NOT NULL,
    region TEXT NOT NULL REFERENCES regions(region_id),
    slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
    face_up INTEGER NOT NULL CHECK (face_up IN (0, 1)),
    control_kind TEXT NOT NULL CHECK (control_kind IN ('unresolved', 'faction', 'unstable')),
    controlling_faction TEXT CHECK (controlling_faction IN ('scottish', 'welsh', 'english')),
    struggle_index INTEGER CHECK (struggle_index BETWEEN 1 AND 8),
    negotiation_disc_seat INTEGER,
    scottish INTEGER NOT NULL CHECK (scottish >= 0),
    welsh INTEGER NOT NULL CHECK (welsh >= 0),
    english INTEGER NOT NULL CHECK (english >= 0),
    CHECK ((control_kind = 'unresolved' AND controlling_faction IS NULL AND struggle_index IS NULL AND face_up = 1)
        OR (control_kind = 'faction' AND controlling_faction IS NOT NULL AND struggle_index IS NOT NULL AND face_up = 0)
        OR (control_kind = 'unstable' AND controlling_faction IS NULL AND struggle_index IS NOT NULL AND face_up = 0)),
    PRIMARY KEY (game_id, event_seq, region),
    UNIQUE (game_id, event_seq, slot),
    FOREIGN KEY (game_id, event_seq) REFERENCES game_snapshots(game_id, event_seq),
    FOREIGN KEY (game_id, negotiation_disc_seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

CREATE TABLE game_results (
    game_id INTEGER PRIMARY KEY REFERENCES games(id),
    event_seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('win', 'draw')),
    method TEXT NOT NULL CHECK (method IN ('invasion', 'coronation')),
    -- Full explanation, scoring cases, virtual Plot support remain in event JSON.
    FOREIGN KEY (game_id, event_seq) REFERENCES game_events(game_id, event_seq)
) STRICT;

CREATE TABLE player_results (
    game_id INTEGER NOT NULL REFERENCES game_results(game_id),
    seat INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('win', 'draw', 'loss')),
    -- Win=1; draw=number of actual contenders, not total players; loss=NULL.
    share_denominator INTEGER,
    score REAL GENERATED ALWAYS AS (
        CASE WHEN outcome = 'loss' THEN 0.0 ELSE 1.0 / share_denominator END
    ) STORED,
    CHECK ((outcome = 'win' AND share_denominator IS NOT NULL AND share_denominator = 1)
        OR (outcome = 'draw' AND share_denominator IS NOT NULL AND share_denominator IN (2, 3))
        OR (outcome = 'loss' AND share_denominator IS NULL)),
    PRIMARY KEY (game_id, seat),
    FOREIGN KEY (game_id, seat) REFERENCES game_players(game_id, seat)
) STRICT, WITHOUT ROWID;

-- Preserve failed/cancelled attempts too; they did not become accepted turns.
CREATE TABLE bot_decisions (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    base_event_seq INTEGER NOT NULL,
    committed_turn_seq INTEGER,
    status TEXT NOT NULL CHECK (status IN ('chosen', 'committed', 'failed', 'cancelled')),
    recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
    budget_iterations INTEGER NOT NULL CHECK (budget_iterations > 0),
    budget_time_ms REAL CHECK (budget_time_ms > 0),
    search_seed INTEGER NOT NULL,
    elapsed_ms REAL CHECK (elapsed_ms >= 0),
    iterations INTEGER CHECK (iterations >= 0),
    nodes INTEGER CHECK (nodes >= 0),
    max_depth INTEGER CHECK (max_depth >= 0),
    horizon INTEGER CHECK (horizon >= 0),
    horizon_visits INTEGER CHECK (horizon_visits >= 0),
    terminal_visits INTEGER CHECK (terminal_visits >= 0),
    root_choices INTEGER CHECK (root_choices >= 0),
    reused_visits INTEGER CHECK (reused_visits >= 0),
    explanation TEXT,
    error_code TEXT,
    plan_json TEXT CHECK (plan_json IS NULL OR (json_valid(plan_json) AND json_type(plan_json) = 'object')),
    environment_json TEXT CHECK (environment_json IS NULL OR (json_valid(environment_json) AND json_type(environment_json) = 'object')),
    CHECK ((status = 'committed' AND committed_turn_seq IS NOT NULL)
        OR (status <> 'committed' AND committed_turn_seq IS NULL)),
    CHECK (status NOT IN ('chosen', 'committed') OR plan_json IS NOT NULL),
    UNIQUE (game_id, request_id),
    UNIQUE (game_id, committed_turn_seq),
    FOREIGN KEY (game_id, seat) REFERENCES game_players(game_id, seat),
    FOREIGN KEY (game_id, base_event_seq) REFERENCES game_events(game_id, event_seq),
    FOREIGN KEY (game_id, committed_turn_seq, seat) REFERENCES turns(game_id, turn_seq, actor_seat)
) STRICT;

-- Existing version-1 exports are presentation logs, not engine event streams.
-- Preserve them losslessly without claiming missing structured data exists.
CREATE TABLE legacy_archives (
    public_id TEXT PRIMARY KEY,
    imported_at_ms INTEGER NOT NULL CHECK (imported_at_ms >= 0),
    archive_json TEXT NOT NULL CHECK (json_valid(archive_json) AND json_type(archive_json) = 'object')
) STRICT;

CREATE INDEX games_recent ON games(created_at_ms DESC, id DESC);
CREATE INDEX games_analysis ON games(source, dataset, mode, rules_version, player_count, status);
CREATE INDEX game_players_bot ON game_players(bot_config_id, game_id, seat);
CREATE INDEX game_players_account ON game_players(account_id, game_id) WHERE account_id IS NOT NULL;
CREATE INDEX game_events_type ON game_events(event_type, game_id, event_seq);
CREATE INDEX turns_actor ON turns(game_id, actor_seat, turn_seq DESC);
CREATE INDEX game_snapshots_turn ON game_snapshots(game_id, turn_seq DESC, event_seq DESC);
CREATE UNIQUE INDEX player_results_one_winner ON player_results(game_id) WHERE outcome = 'win';
CREATE INDEX bot_decisions_history ON bot_decisions(game_id, base_event_seq, seat);

CREATE VIEW v_turn_history AS
SELECT g.public_id, t.*, p.display_name, p.controller,
       b.strategy, b.version AS bot_version, e.recorded_at_ms
FROM turns AS t
JOIN games AS g ON g.id = t.game_id
JOIN game_players AS p ON p.game_id = t.game_id AND p.seat = t.actor_seat
JOIN game_events AS e ON e.game_id = t.game_id AND e.event_seq = t.event_seq
LEFT JOIN bot_configs AS b ON b.id = p.bot_config_id;

CREATE VIEW v_latest_moves AS
SELECT * FROM (
    SELECT h.*, row_number() OVER (
        PARTITION BY h.game_id, h.actor_seat ORDER BY h.turn_seq DESC
    ) AS move_rank
    FROM v_turn_history AS h
) WHERE move_rank = 1;

CREATE VIEW v_player_results AS
SELECT g.id AS game_id, g.public_id, g.mode, g.rules_version, g.player_count,
       g.source, g.dataset, g.setup_group, g.starting_seat, g.last_turn_seq,
       p.seat, p.display_name, p.controller, p.bot_config_id,
       b.strategy, b.version AS bot_version, r.kind AS result_kind, r.method,
       pr.outcome, pr.score
FROM games AS g
JOIN game_results AS r ON r.game_id = g.id
JOIN player_results AS pr ON pr.game_id = g.id
JOIN game_players AS p ON p.game_id = pr.game_id AND p.seat = pr.seat
LEFT JOIN bot_configs AS b ON b.id = p.bot_config_id
WHERE g.status = 'finished';

-- Record migration 1 with its checksum in the migration runner, in this same
-- transaction. Do not edit this migration after it has been applied.
PRAGMA user_version = 1;
COMMIT;
