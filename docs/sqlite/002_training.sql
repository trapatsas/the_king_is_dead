-- Proposal migration 2: apply AFTER schema.sql (user_version = 1).
-- Raw games remain authoritative. These tables are a rebuildable ML projection.
-- This does not install a writer/API or implement the feature encoder.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
BEGIN IMMEDIATE;

CREATE TABLE ml_feature_schemas (
    version TEXT PRIMARY KEY,
    rules_version TEXT NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count > 0),
    dtype TEXT NOT NULL CHECK (dtype = 'float32-le'),
    schema_hash TEXT NOT NULL CHECK (length(schema_hash) = 64),
    schema_json TEXT NOT NULL CHECK (json_valid(schema_json) AND json_type(schema_json) = 'object'),
    encoder_revision TEXT NOT NULL,
    UNIQUE (version, feature_count)
) STRICT;

-- Admission occurs only AFTER replay and final scoring have been validated.
-- Hashes omit display names, game IDs and wall-clock timestamps.
CREATE TABLE ml_games (
    game_id INTEGER PRIMARY KEY REFERENCES games(id),
    family_hash TEXT NOT NULL CHECK (length(family_hash) = 64),
    trajectory_hash TEXT NOT NULL CHECK (length(trajectory_hash) = 64),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('human', 'teacher', 'self_play', 'import')),
    source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
    validator_revision TEXT NOT NULL,
    validated_at_ms INTEGER NOT NULL CHECK (validated_at_ms >= 0),
    UNIQUE (game_id, family_hash, trajectory_hash)
) STRICT;
CREATE INDEX ml_games_family ON ml_games(family_hash, game_id);
CREATE INDEX ml_games_source ON ml_games(source_kind, game_id);

CREATE TRIGGER ml_games_completed BEFORE INSERT ON ml_games
WHEN NOT EXISTS (
    SELECT 1 FROM games AS g JOIN game_results AS r ON r.game_id = g.id
    WHERE g.id = NEW.game_id AND g.mode = 'standard' AND g.status = 'finished'
      AND (SELECT count(*) FROM player_results WHERE game_id = g.id) = g.player_count
      AND abs((SELECT sum(score) FROM player_results WHERE game_id = g.id) - 1.0) < 0.000001
)
BEGIN SELECT RAISE(ABORT, 'ML admission requires completed Standard game and complete outcomes'); END;

-- One vector for the NONTERMINAL position BEFORE an accepted turn.
-- Integer rowid keeps the ~1.9 KB payload in a rowid table, not a wide index.
CREATE TABLE ml_positions (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES ml_games(game_id),
    turn_seq INTEGER NOT NULL,
    base_event_seq INTEGER NOT NULL CHECK (base_event_seq >= 0),
    feature_version TEXT NOT NULL,
    feature_count INTEGER NOT NULL,
    -- Canonical network seat -> original clockwise seat. c0 is the actor.
    c0 INTEGER NOT NULL CHECK (c0 BETWEEN 0 AND 2),
    c1 INTEGER NOT NULL CHECK (c1 BETWEEN 0 AND 2),
    c2 INTEGER CHECK (c2 BETWEEN 0 AND 2),
    features BLOB NOT NULL CHECK (length(features) = 4 * feature_count),
    features_hash TEXT NOT NULL CHECK (length(features_hash) = 64),
    CHECK (c0 <> c1),
    CHECK ((c2 IS NULL AND c0 < 2 AND c1 < 2)
        OR (c2 IS NOT NULL AND c2 <> c0 AND c2 <> c1)),
    UNIQUE (game_id, turn_seq, feature_version),
    UNIQUE (id, game_id, feature_version),
    FOREIGN KEY (game_id, turn_seq, c0) REFERENCES turns(game_id, turn_seq, actor_seat),
    FOREIGN KEY (game_id, base_event_seq) REFERENCES game_events(game_id, event_seq),
    FOREIGN KEY (game_id, c1) REFERENCES game_players(game_id, seat),
    FOREIGN KEY (game_id, c2) REFERENCES game_players(game_id, seat),
    FOREIGN KEY (feature_version, feature_count) REFERENCES ml_feature_schemas(version, feature_count)
) STRICT;

CREATE TRIGGER ml_positions_frame BEFORE INSERT ON ml_positions
WHEN NOT EXISTS (
    SELECT 1 FROM games AS g
    JOIN turns AS t ON t.game_id = g.id AND t.turn_seq = NEW.turn_seq
    JOIN game_snapshots AS s ON s.game_id = g.id AND s.event_seq = NEW.base_event_seq
    JOIN ml_feature_schemas AS f ON f.version = NEW.feature_version
    WHERE g.id = NEW.game_id AND g.rules_version = f.rules_version
      AND s.phase = 'turn' AND s.turn_seq = NEW.turn_seq - 1
      AND s.active_seat = NEW.c0 AND NEW.base_event_seq < t.event_seq
      AND NEW.c1 = (NEW.c0 + 1) % g.player_count
      AND ((g.player_count = 2 AND NEW.c2 IS NULL)
        OR (g.player_count = 3 AND NEW.c2 IS NOT NULL AND NEW.c2 = (NEW.c0 + 2) % 3))
)
BEGIN SELECT RAISE(ABORT, 'Invalid pre-turn checkpoint, feature rules or canonical frame'); END;

CREATE TABLE ml_datasets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    feature_version TEXT NOT NULL REFERENCES ml_feature_schemas(version),
    status TEXT NOT NULL CHECK (status IN ('building', 'frozen')),
    split_seed TEXT NOT NULL,
    config_json TEXT NOT NULL CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    frozen_at_ms INTEGER,
    manifest_hash TEXT CHECK (length(manifest_hash) = 64),
    CHECK ((status = 'building' AND frozen_at_ms IS NULL AND manifest_hash IS NULL)
        OR (status = 'frozen' AND frozen_at_ms IS NOT NULL
            AND frozen_at_ms >= created_at_ms AND manifest_hash IS NOT NULL)),
    UNIQUE (id, feature_version)
) STRICT;

-- Every setup family has exactly one split IN THIS DATASET.
-- The builder must also apply global final-test exclusions across datasets.
CREATE TABLE ml_dataset_families (
    dataset_id INTEGER NOT NULL REFERENCES ml_datasets(id),
    family_hash TEXT NOT NULL CHECK (length(family_hash) = 64),
    split TEXT NOT NULL CHECK (split IN ('train', 'validation', 'test')),
    PRIMARY KEY (dataset_id, family_hash),
    UNIQUE (dataset_id, family_hash, split)
) STRICT, WITHOUT ROWID;

CREATE TABLE ml_dataset_games (
    dataset_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    family_hash TEXT NOT NULL,
    trajectory_hash TEXT NOT NULL,
    PRIMARY KEY (dataset_id, game_id),
    -- Re-importing the same trajectory under a different UUID cannot duplicate it.
    UNIQUE (dataset_id, trajectory_hash),
    UNIQUE (dataset_id, game_id, family_hash),
    FOREIGN KEY (dataset_id, family_hash) REFERENCES ml_dataset_families(dataset_id, family_hash),
    FOREIGN KEY (game_id, family_hash, trajectory_hash) REFERENCES ml_games(game_id, family_hash, trajectory_hash)
) STRICT, WITHOUT ROWID;

-- Compact ordered membership; vectors are stored once in ml_positions.
-- ordinal starts at zero per split. Assign a seeded order at materialization.
CREATE TABLE ml_dataset_samples (
    dataset_id INTEGER NOT NULL,
    split TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    position_id INTEGER NOT NULL,
    game_id INTEGER NOT NULL,
    family_hash TEXT NOT NULL,
    feature_version TEXT NOT NULL,
    sample_weight REAL NOT NULL DEFAULT 1.0 CHECK (sample_weight > 0 AND sample_weight <= 100),
    PRIMARY KEY (dataset_id, split, ordinal),
    UNIQUE (dataset_id, position_id),
    FOREIGN KEY (dataset_id, feature_version) REFERENCES ml_datasets(id, feature_version),
    FOREIGN KEY (dataset_id, family_hash, split) REFERENCES ml_dataset_families(dataset_id, family_hash, split),
    FOREIGN KEY (dataset_id, game_id, family_hash) REFERENCES ml_dataset_games(dataset_id, game_id, family_hash),
    FOREIGN KEY (position_id, game_id, feature_version) REFERENCES ml_positions(id, game_id, feature_version)
) STRICT, WITHOUT ROWID;

-- Immutable derived inputs. Fix an encoder by publishing another feature version.
CREATE TRIGGER ml_positions_no_update BEFORE UPDATE ON ml_positions
BEGIN SELECT RAISE(ABORT, 'Feature rows are immutable'); END;
CREATE TRIGGER ml_positions_no_delete BEFORE DELETE ON ml_positions
BEGIN SELECT RAISE(ABORT, 'Feature rows are immutable'); END;
CREATE TRIGGER ml_games_no_update BEFORE UPDATE ON ml_games
BEGIN SELECT RAISE(ABORT, 'Validated game metadata is immutable'); END;
CREATE TRIGGER ml_games_no_delete BEFORE DELETE ON ml_games
BEGIN SELECT RAISE(ABORT, 'Validated game metadata is immutable'); END;
CREATE TRIGGER ml_schemas_no_update BEFORE UPDATE ON ml_feature_schemas
BEGIN SELECT RAISE(ABORT, 'Feature schemas are immutable'); END;
CREATE TRIGGER ml_schemas_no_delete BEFORE DELETE ON ml_feature_schemas
BEGIN SELECT RAISE(ABORT, 'Feature schemas are immutable'); END;
CREATE TRIGGER ml_datasets_build_first BEFORE INSERT ON ml_datasets
WHEN NEW.status <> 'building'
BEGIN SELECT RAISE(ABORT, 'Create datasets in building state'); END;
CREATE TRIGGER ml_datasets_frozen_update BEFORE UPDATE ON ml_datasets
WHEN OLD.status = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen datasets are immutable'); END;
CREATE TRIGGER ml_datasets_frozen_delete BEFORE DELETE ON ml_datasets
WHEN OLD.status = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen datasets are immutable'); END;

CREATE TRIGGER ml_dataset_families_insert BEFORE INSERT ON ml_dataset_families
WHEN (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_families_update BEFORE UPDATE ON ml_dataset_families
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen' OR (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_families_delete BEFORE DELETE ON ml_dataset_families
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_games_insert BEFORE INSERT ON ml_dataset_games
WHEN (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_games_update BEFORE UPDATE ON ml_dataset_games
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen' OR (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_games_delete BEFORE DELETE ON ml_dataset_games
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_samples_insert BEFORE INSERT ON ml_dataset_samples
WHEN (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_samples_update BEFORE UPDATE ON ml_dataset_samples
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen' OR (SELECT status FROM ml_datasets WHERE id = NEW.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE TRIGGER ml_dataset_samples_delete BEFORE DELETE ON ml_dataset_samples
WHEN (SELECT status FROM ml_datasets WHERE id = OLD.dataset_id) = 'frozen'
BEGIN SELECT RAISE(ABORT, 'Frozen dataset membership is immutable'); END;

CREATE VIEW v_ml_training_samples AS
SELECT s.dataset_id, s.split, s.ordinal, s.sample_weight,
       p.id AS position_id, p.game_id, p.turn_seq, p.feature_version,
       p.feature_count, p.features, p.features_hash, p.c0, p.c1, p.c2,
       CASE WHEN p.c2 IS NULL THEN 2 ELSE 3 END AS player_count,
       m.source_kind, m.family_hash, m.trajectory_hash,
       r0.score AS target0, r1.score AS target1,
       coalesce(r2.score, 0.0) AS target2
FROM ml_dataset_samples AS s
JOIN ml_datasets AS d ON d.id = s.dataset_id AND d.status = 'frozen'
JOIN ml_positions AS p ON p.id = s.position_id
JOIN ml_games AS m ON m.game_id = p.game_id
JOIN player_results AS r0 ON r0.game_id = p.game_id AND r0.seat = p.c0
JOIN player_results AS r1 ON r1.game_id = p.game_id AND r1.seat = p.c1
LEFT JOIN player_results AS r2 ON r2.game_id = p.game_id AND r2.seat = p.c2;

-- Repository validates source/result immutability and dataset manifest hash.
-- SQL constraints do not replace legal replay or finite-float validation.
-- Record migration checksum/time through the runner, before this COMMIT.
PRAGMA user_version = 2;
COMMIT;
