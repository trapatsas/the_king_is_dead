-- 1. Training batches. Start :after_ordinal at -1; advance to the last ordinal.
-- The primary key (dataset_id, split, ordinal) supports this bounded scan.
-- No JSON decoding, OFFSET or ORDER BY random() in an epoch.
SELECT ordinal, position_id, game_id, turn_seq, source_kind, player_count,
       features, target0, target1, target2, sample_weight
FROM v_ml_training_samples
WHERE dataset_id = :dataset_id AND split = :split AND ordinal > :after_ordinal
ORDER BY ordinal
LIMIT :batch_size;

-- 2. One game's input vectors, for audits / game-first sampling.
SELECT p.id, p.turn_seq, p.base_event_seq, p.c0, p.c1, p.c2,
       p.features, p.features_hash
FROM ml_positions AS p
WHERE p.game_id = :game_id AND p.feature_version = :feature_version
ORDER BY p.turn_seq;

-- 3. Coverage by source and seat count. Run at build/audit time, not per batch.
SELECT split, source_kind, player_count, count(*) AS positions,
       count(DISTINCT game_id) AS games
FROM v_ml_training_samples
WHERE dataset_id = :dataset_id
GROUP BY split, source_kind, player_count;

-- 4. Find completed games requiring replay validation before ML admission.
SELECT g.id, g.public_id, g.rules_version, g.player_count, g.last_event_seq
FROM games AS g
LEFT JOIN ml_games AS m ON m.game_id = g.id
WHERE g.mode = 'standard' AND g.status = 'finished' AND m.game_id IS NULL
  AND g.id > :after_game_id
ORDER BY g.id
LIMIT :batch_size;

-- 5. Materialization can find candidate inputs using the per-game index.
SELECT p.id, p.game_id, p.turn_seq, p.feature_version,
       g.family_hash, f.split
FROM ml_dataset_games AS g
JOIN ml_datasets AS d ON d.id = g.dataset_id
JOIN ml_dataset_families AS f ON f.dataset_id = g.dataset_id AND f.family_hash = g.family_hash
JOIN ml_positions AS p ON p.game_id = g.game_id AND p.feature_version = d.feature_version
WHERE g.dataset_id = :dataset_id
ORDER BY g.game_id, p.turn_seq;
