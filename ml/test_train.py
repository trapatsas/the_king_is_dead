import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

import torch

from train import Dataset, FEATURE_COUNT, FEATURE_VERSION, losses, network


class TrainingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / "fixture.sqlite"
        db = sqlite3.connect(self.path)
        db.executescript((Path(__file__).resolve().parents[1] / "docs/sqlite/training_export.sql").read_text())
        db.execute("INSERT INTO manifest VALUES(1,1,'unit-fixture',?,474,'float32-le',?,2,?)",
                   (FEATURE_VERSION, "a"*64, json.dumps({"synthetic": False, "testOnly": True})))
        for i, split in enumerate(("train", "validation"), 1):
            db.execute("INSERT INTO samples VALUES(?,1,?,?,?,?,2,1,474,?,1.0,0.0,0.0,1.0)",
                       (i, split, f"game-{i}", str(i)*64, "teacher", struct.pack("<474f", *([0.0]*474))))
        db.commit()
        db.close()

    def tearDown(self):
        self.folder.cleanup()

    def test_reader_and_mask(self):
        data = Dataset(self.path)
        try:
            x,y,present,weights = data.batch([1])
            self.assertEqual(tuple(x.shape), (1, FEATURE_COUNT))
            self.assertEqual(present.tolist(), [[True, True, False]])
            self.assertEqual(y.tolist(), [[1.0, 0.0, 0.0]])
            self.assertEqual(weights.tolist(), [1.0])
        finally:
            data.close()

    def test_masked_loss_has_no_padding_nan_or_gradient(self):
        logits = torch.tensor([[1.0, 2.0, 100.0]], requires_grad=True)
        y = torch.tensor([[1.0, 0.0, 0.0]])
        mask = torch.tensor([[True, True, False]])
        loss = losses(logits,y,mask).sum()
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        self.assertEqual(logits.grad[0,2].item(), 0)

    def test_rejects_nonfinite_vector(self):
        db=sqlite3.connect(self.path)
        db.execute("UPDATE samples SET features=? WHERE id=1", (struct.pack("<474f", float('nan'), *([0.0]*473)),))
        db.commit();db.close()
        data=Dataset(self.path)
        try:
            with self.assertRaisesRegex(ValueError,"Invalid feature"):
                data.batch([1])
        finally:
            data.close()

    def test_rejects_family_leakage(self):
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE samples SET family_hash=?", ('a'*64,))
        with self.assertRaisesRegex(ValueError,"crosses"):
            Dataset(self.path)

    def test_parameter_count(self):
        self.assertEqual(sum(p.numel() for p in network(128).parameters()), 77699)
        self.assertEqual(sum(p.numel() for p in network(0).parameters()), 1425)


if __name__ == '__main__':
    unittest.main()
