"""Schema contract checks and a tiny SYNTHETIC training-file example.

Run: python3 docs/sqlite/validate_training.py
Example: python3 docs/sqlite/validate_training.py --example /tmp/training-example.sqlite
The fixtures test SQL structure, not game legality or the unimplemented encoder.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
FEATURE_VERSION = "fixture-474-v1"


def digest(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def connect():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript((HERE / "schema.sql").read_text())
    db.executescript((HERE / "002_training.sql").read_text())
    return db


def seed_game(db, game_id, count, actor, completed=True):
    status = "finished" if completed else "in_progress"
    db.execute(
        """INSERT INTO games(id, public_id, mode, rules_version,
        state_schema_version, status, player_count, starting_seat, source,
        created_at_ms, updated_at_ms, finished_at_ms,
        last_event_seq, last_turn_seq, last_action_seq)
        VALUES (?, ?, 'standard', 'project-2-3-v1', 4, ?, ?, ?, 'import',
        0, 1, ?, 2, 1, 0)""",
        (game_id, f"fixture-game-{game_id}", status, count, actor, 1 if completed else None),
    )
    for seat in range(count):
        db.execute(
            "INSERT INTO game_players(game_id, seat, engine_player_id, display_name, controller) VALUES (?, ?, ?, ?, 'human')",
            (game_id, seat, f"p{seat}", f"Fixture {seat}"),
        )
    for seq, event in enumerate(("GameCreated", "TurnCommitted", "GameFinished")):
        db.execute(
            """INSERT INTO game_events VALUES (?, ?, ?, 0, ?, ?, 0, 1, ?)""",
            (game_id, seq, min(seq, 1), event, None if seq == 0 else actor,
             json.dumps({"syntheticSchemaFixture": True, "type": event})),
        )
    db.execute(
        "INSERT INTO turns(game_id, turn_seq, event_seq, actor_seat, kind) VALUES (?, 1, 1, ?, 'pass')",
        (game_id, actor),
    )
    db.execute(
        "INSERT INTO game_snapshots VALUES (?, 0, 0, 'turn', ?, 4, ?)",
        (game_id, actor, '{"syntheticSchemaFixture":true}'),
    )
    if completed:
        db.execute("INSERT INTO game_results VALUES (?, 2, ?, 'coronation')",
                   (game_id, "win" if count == 2 else "draw"))
        for seat in range(count):
            outcome = ("win" if seat == 0 else "loss") if count == 2 else ("draw" if seat in (0, 2) else "loss")
            denominator = 1 if outcome == "win" else 2 if outcome == "draw" else None
            db.execute("INSERT INTO player_results(game_id, seat, outcome, share_denominator) VALUES (?, ?, ?, ?)",
                       (game_id, seat, outcome, denominator))


def seed(db):
    db.execute("INSERT INTO ml_feature_schemas VALUES (?, 'project-2-3-v1', 474, 'float32-le', ?, ?, 'fixture')",
               (FEATURE_VERSION, digest("schema"), '{"synthetic":true,"feature_count":474}'))
    for game, count, actor in ((1, 2, 1), (2, 3, 2), (3, 2, 0)):
        seed_game(db, game, count, actor, completed=game != 3)
        if game == 3:
            continue
        db.execute("INSERT INTO ml_games VALUES (?, ?, ?, 'human', ?, 'fixture-NOT-replay-validation', 1)",
                   (game, digest(f"family-{game}"), digest(f"trajectory-{game}"), digest(game)))
        features = struct.pack("<474f", game / 10, *([0.0] * 473))
        db.execute("""INSERT INTO ml_positions VALUES (?, ?, 1, 0, ?, 474, ?, ?, ?, ?, ?)""",
                   (game, game, FEATURE_VERSION, actor, (actor + 1) % count,
                    (actor + 2) % count if count == 3 else None,
                    features, hashlib.sha256(features).hexdigest()))
    db.execute("""INSERT INTO ml_datasets VALUES (1, 'synthetic-example', ?, 'building',
               'fixture-split', '{"synthetic":true}', 0, NULL, NULL)""", (FEATURE_VERSION,))
    for game, split in ((1, "train"), (2, "validation")):
        family = digest(f"family-{game}")
        db.execute("INSERT INTO ml_dataset_families VALUES (1, ?, ?)", (family, split))
        db.execute("INSERT INTO ml_dataset_games VALUES (1, ?, ?, ?)",
                   (game, family, digest(f"trajectory-{game}")))
        db.execute("INSERT INTO ml_dataset_samples VALUES (1, ?, 0, ?, ?, ?, ?, 1.0)",
                   (split, game, game, family, FEATURE_VERSION))
    db.commit()


def freeze(db):
    db.execute("UPDATE ml_datasets SET status='frozen', frozen_at_ms=2, manifest_hash=? WHERE id=1",
               (digest("synthetic manifest"),))
    db.commit()


def batch_sql():
    text = (HERE / "training_queries.sql").read_text()
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("--")).split(";")[0]


def export_example(db, path):
    if path.exists():
        raise FileExistsError(f"Refusing to replace {path}")
    out = sqlite3.connect(path)
    try:
        out.executescript((HERE / "training_export.sql").read_text())
        rows = db.execute("SELECT * FROM v_ml_training_samples ORDER BY split, ordinal").fetchall()
        metadata = json.dumps({"synthetic": True, "purpose": "Schema/reader demonstration only; not real games or encoded training data"})
        out.execute("INSERT INTO manifest VALUES (1, 1, 'synthetic-example', ?, 474, 'float32-le', ?, ?, ?)",
                    (FEATURE_VERSION, digest("synthetic manifest"), len(rows), metadata))
        for index, row in enumerate(rows, 1):
            out.execute("""INSERT INTO samples VALUES (?, 1, ?, ?, ?, ?, ?, ?, 474, ?, ?, ?, ?, ?)""",
                        (index, row["split"], f"fixture-{row['game_id']}", row["family_hash"],
                         row["source_kind"], row["player_count"], row["turn_seq"], row["features"],
                         row["target0"], row["target1"], row["target2"], row["sample_weight"]))
        out.commit()
        assert not out.execute("PRAGMA foreign_key_check").fetchall()
        assert out.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        out.close()


class TrainingSchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = connect()
        seed(self.db)

    def tearDown(self):
        self.db.close()

    def test_integrity(self):
        self.assertEqual(self.db.execute("PRAGMA user_version").fetchone()[0], 2)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_building_not_visible(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM v_ml_training_samples").fetchone()[0], 0)

    def test_labels_rotate_and_padding_is_zero(self):
        freeze(self.db)
        rows = self.db.execute("SELECT target0,target1,target2 FROM v_ml_training_samples ORDER BY game_id").fetchall()
        self.assertEqual([tuple(row) for row in rows], [(0.0, 1.0, 0.0), (0.5, 0.5, 0.0)])

    def test_incomplete_game_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO ml_games VALUES (3, ?, ?, 'human', ?, 'fixture', 0)",
                            (digest(3), digest(3), digest(3)))

    def test_wrong_blob_size_rejected(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "length\\(features\\)"):
            self.db.execute("""INSERT INTO ml_positions SELECT 4, game_id, turn_seq, base_event_seq,
              feature_version, feature_count, c0,c1,c2, X'00', features_hash FROM ml_positions WHERE id=1""")

    def test_wrong_frame_rejected(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError, "canonical frame"):
            self.db.execute("""INSERT INTO ml_positions SELECT 4, game_id, turn_seq, base_event_seq,
              feature_version, feature_count, c1,c0,c2, features, features_hash FROM ml_positions WHERE id=1""")

    def test_family_cannot_cross_splits(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ml_dataset_samples SET split='test' WHERE game_id=1")

    def test_dataset_cannot_mix_encoders(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ml_dataset_samples SET feature_version='other' WHERE game_id=1")

    def test_trajectory_duplicates_rejected(self):
        seed_game(self.db, 4, 2, 1)
        self.db.execute("INSERT INTO ml_games SELECT 4,family_hash,trajectory_hash,source_kind,source_digest,validator_revision,validated_at_ms FROM ml_games WHERE game_id=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO ml_dataset_games SELECT 1,4,family_hash,trajectory_hash FROM ml_games WHERE game_id=4")

    def test_frozen_membership_rejected(self):
        freeze(self.db)
        for table in ("ml_dataset_samples", "ml_dataset_games", "ml_dataset_families", "ml_datasets"):
            with self.subTest(table=table), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"DELETE FROM {table}")

    def test_features_immutable(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE ml_positions SET features_hash=? WHERE id=1", (digest("change"),))

    def test_keyset_query_uses_membership_index(self):
        freeze(self.db)
        args = dict(dataset_id=1, split="train", after_ordinal=-1, batch_size=32)
        rows = self.db.execute(batch_sql(), args).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]["features"]), 1896)
        plan = self.db.execute("EXPLAIN QUERY PLAN " + batch_sql(), args).fetchall()
        self.assertTrue(any("SEARCH s USING PRIMARY KEY" in row[3] for row in plan), [tuple(row) for row in plan])
        args["after_ordinal"] = rows[-1]["ordinal"]
        self.assertEqual(self.db.execute(batch_sql(), args).fetchall(), [])

    def test_portable_export_round_trip(self):
        freeze(self.db)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "example.sqlite"
            export_example(self.db, path)
            with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as reader:
                manifest = reader.execute("SELECT feature_version, sample_count, metadata_json FROM manifest").fetchone()
                self.assertEqual(manifest[:2], (FEATURE_VERSION, 2))
                self.assertTrue(json.loads(manifest[2])["synthetic"])
                vector, a, b, c = reader.execute("SELECT features, target0, target1, target2 FROM samples WHERE split='train'").fetchone()
                self.assertEqual(len(struct.unpack("<474f", vector)), 474)
                self.assertAlmostEqual(struct.unpack("<474f", vector)[0], 0.1)
                self.assertEqual((a, b, c), (0.0, 1.0, 0.0))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--example", type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(TrainingSchemaTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.example:
        db = connect()
        seed(db)
        freeze(db)
        export_example(db, args.example)
        db.close()
        print(f"Wrote SYNTHETIC example: {args.example}")
