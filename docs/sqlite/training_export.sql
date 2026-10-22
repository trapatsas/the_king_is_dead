-- A SEPARATE, portable, training-only SQLite file. Do not apply to king.sqlite.
-- Populate once from a validated frozen source dataset, verify, then open read-only.
PRAGMA foreign_keys = ON;
BEGIN;
CREATE TABLE manifest (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    dataset_name TEXT NOT NULL,
    feature_version TEXT NOT NULL,
    feature_count INTEGER NOT NULL CHECK (feature_count > 0),
    dtype TEXT NOT NULL CHECK (dtype = 'float32-le'),
    source_manifest_hash TEXT NOT NULL CHECK (length(source_manifest_hash) = 64),
    sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
    metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
    UNIQUE (id, feature_count)
) STRICT;
CREATE TABLE samples (
    id INTEGER PRIMARY KEY,
    manifest_id INTEGER NOT NULL DEFAULT 1 CHECK (manifest_id = 1),
    split TEXT NOT NULL CHECK (split IN ('train', 'validation', 'test')),
    game_key TEXT NOT NULL,
    family_hash TEXT NOT NULL CHECK (length(family_hash) = 64),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('human', 'teacher', 'self_play', 'import')),
    player_count INTEGER NOT NULL CHECK (player_count IN (2, 3)),
    turn_seq INTEGER NOT NULL CHECK (turn_seq > 0),
    feature_count INTEGER NOT NULL,
    features BLOB NOT NULL CHECK (length(features) = 4 * feature_count),
    target0 REAL NOT NULL CHECK (target0 BETWEEN 0 AND 1),
    target1 REAL NOT NULL CHECK (target1 BETWEEN 0 AND 1),
    target2 REAL NOT NULL CHECK (target2 BETWEEN 0 AND 1),
    sample_weight REAL NOT NULL CHECK (sample_weight > 0 AND sample_weight <= 100),
    CHECK (abs(target0 + target1 + target2 - 1.0) < 0.000001),
    CHECK (player_count = 3 OR target2 = 0.0),
    UNIQUE (game_key, turn_seq),
    FOREIGN KEY (manifest_id, feature_count) REFERENCES manifest(id, feature_count)
) STRICT;
CREATE INDEX samples_split ON samples(split, id);
CREATE INDEX samples_source ON samples(split, source_kind, player_count, id);
PRAGMA user_version = 1;
COMMIT;
