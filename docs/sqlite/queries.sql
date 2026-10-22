-- Read-only examples for analysts on the PRIVATE database.
-- Bind named parameters in the driver. Never interpolate SQL strings.
-- Suggested bindings: :public_id, :after_event_seq, :limit, :turn_seq,
-- :source, :dataset, :mode, :rules_version, :player_count.

-- 1. Find a game by the existing king-UUID ID, including every seat's result.
SELECT g.public_id, g.status, g.mode, g.last_turn_seq, g.created_at_ms,
       p.seat, p.display_name, p.controller, b.strategy, b.version,
       r.method, pr.outcome, pr.score
FROM games AS g
JOIN game_players AS p ON p.game_id = g.id
LEFT JOIN bot_configs AS b ON b.id = p.bot_config_id
LEFT JOIN game_results AS r ON r.game_id = g.id
LEFT JOIN player_results AS pr ON pr.game_id = p.game_id AND pr.seat = p.seat
WHERE g.public_id = :public_id
ORDER BY p.seat;

-- 2. Ordered history with cursor pagination (bind -1 for the first page).
-- payload_json is internal; public APIs must use the redacted log projection.
SELECT e.event_seq, e.turn_seq, e.action_seq, e.event_type,
       p.display_name, e.payload_version, e.payload_json
FROM game_events AS e
JOIN games AS g ON g.id = e.game_id
LEFT JOIN game_players AS p ON p.game_id = e.game_id AND p.seat = e.actor_seat
WHERE g.public_id = :public_id AND e.event_seq > :after_event_seq
ORDER BY e.event_seq
LIMIT :limit;

-- 3. Each seat's last committed move, including passes. No move yet => NULL.
SELECT p.seat, p.display_name, h.turn_seq, h.kind, h.card_type,
       h.summon_region, h.summon_faction
FROM games AS g
JOIN game_players AS p ON p.game_id = g.id
LEFT JOIN v_latest_moves AS h ON h.game_id = p.game_id AND h.actor_seat = p.seat
WHERE g.public_id = :public_id
ORDER BY p.seat;

-- 4. Board after a turn, including any immediate struggle/scoring events.
-- At turn 0 this shows setup. Plot choices can add checkpoints at the same turn.
WITH checkpoint AS (
    SELECT s.game_id, s.event_seq
    FROM game_snapshots AS s JOIN games AS g ON g.id = s.game_id
    WHERE g.public_id = :public_id AND s.turn_seq <= :turn_seq
    ORDER BY s.turn_seq DESC, s.event_seq DESC
    LIMIT 1
)
SELECT r.*
FROM checkpoint AS c
JOIN region_snapshots AS r ON r.game_id = c.game_id AND r.event_seq = c.event_seq
ORDER BY r.slot;

-- 5. Performance by exact bot configuration and starting position.
-- Filter a homogeneous cohort; changing opponents/budgets changes the question.
SELECT bot_config_id, strategy, bot_version, seat = starting_seat AS started,
       count(*) AS games,
       sum(outcome = 'win') AS wins,
       sum(outcome = 'draw') AS draws,
       sum(outcome = 'loss') AS losses,
       round(avg(score), 4) AS mean_score,
       round(avg(last_turn_seq), 2) AS mean_game_turns
FROM v_player_results
WHERE controller = 'algorithmic'
  AND source = :source AND dataset = :dataset
  AND mode = :mode AND rules_version = :rules_version
  AND player_count = :player_count
GROUP BY bot_config_id, strategy, bot_version, seat = starting_seat
ORDER BY mean_score DESC;

-- 6. How many cards did everyone retain when the first struggle resolved?
-- Match the checkpoint at the END of that struggle's command batch.
WITH first_struggle AS (
    SELECT s.game_id, s.turn_seq, s.event_seq
    FROM struggles AS s
    WHERE s.struggle_index = 1
), checkpoint AS (
    SELECT f.game_id, f.turn_seq,
        (SELECT min(s.event_seq) FROM game_snapshots AS s
         WHERE s.game_id = f.game_id AND s.turn_seq = f.turn_seq
           AND s.event_seq >= f.event_seq) AS snapshot_event_seq
    FROM first_struggle AS f
)
SELECT g.public_id, c.turn_seq AS first_struggle_turn,
       p.seat, p.display_name, b.strategy, b.version AS bot_version, ps.hand_count
FROM checkpoint AS c
JOIN games AS g ON g.id = c.game_id
JOIN player_snapshots AS ps ON ps.game_id = c.game_id AND ps.event_seq = c.snapshot_event_seq
JOIN game_players AS p ON p.game_id = ps.game_id AND p.seat = ps.seat
LEFT JOIN bot_configs AS b ON b.id = p.bot_config_id
WHERE g.public_id = :public_id
ORDER BY p.seat;

-- 7. Search cost, with failed/cancelled attempts visible as separate groups.
SELECT g.mode, g.rules_version, g.player_count,
       p.bot_config_id, b.strategy, b.version, d.status,
       json_extract(d.environment_json, '$.runtime') AS runtime,
       json_extract(d.environment_json, '$.device_class') AS device_class,
       d.budget_iterations, d.budget_time_ms,
       count(*) AS attempts, round(avg(d.elapsed_ms), 2) AS mean_elapsed_ms,
       round(avg(d.iterations), 1) AS mean_iterations,
       max(d.max_depth) AS max_depth
FROM bot_decisions AS d
JOIN game_players AS p ON p.game_id = d.game_id AND p.seat = d.seat
LEFT JOIN bot_configs AS b ON b.id = p.bot_config_id
JOIN games AS g ON g.id = d.game_id
WHERE g.source = :source AND g.dataset = :dataset
GROUP BY g.mode, g.rules_version, g.player_count,
         p.bot_config_id, b.strategy, b.version, d.status,
         json_extract(d.environment_json, '$.runtime'),
         json_extract(d.environment_json, '$.device_class'),
         d.budget_iterations, d.budget_time_ms;

-- 8. Card expenditure/pass rate per seat (passes are turns, not actions).
SELECT p.seat, p.display_name, count(t.turn_seq) AS turns_taken,
       coalesce(sum(t.kind = 'pass'), 0) AS passes,
       coalesce(sum(t.kind = 'card'), 0) AS cards_spent,
       coalesce(sum(t.kind = 'card' AND t.no_effect_reason IS NOT NULL), 0) AS no_effect_cards
FROM games AS g
JOIN game_players AS p ON p.game_id = g.id
LEFT JOIN turns AS t ON t.game_id = p.game_id AND t.actor_seat = p.seat
WHERE g.public_id = :public_id
GROUP BY p.seat, p.display_name
ORDER BY p.seat;

-- 9. Retrieve the authoritative terminal result, including every scoring case.
SELECT e.payload_json
FROM games AS g
JOIN game_results AS r ON r.game_id = g.id
JOIN game_events AS e ON e.game_id = r.game_id AND e.event_seq = r.event_seq
WHERE g.public_id = :public_id;
