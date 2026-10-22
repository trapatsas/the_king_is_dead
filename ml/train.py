"""Train a masked outcome-value MLP from a frozen SQLite export.

Only actual visited, completed-game positions are targets. This script does
not simulate rules, invent counterfactual results, or automatically promote models.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

import numpy as np
import torch
from torch import nn

FEATURE_VERSION = "standard-v1"
FEATURE_COUNT = 474


class Dataset:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.db = sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row
        row = self.db.execute("SELECT * FROM manifest WHERE id=1").fetchone()
        if row is None:
            raise ValueError("Missing dataset manifest")
        self.manifest = dict(row)
        metadata = json.loads(row["metadata_json"])
        if row["format_version"] != 1 or row["feature_version"] != FEATURE_VERSION or row["feature_count"] != FEATURE_COUNT or row["dtype"] != "float32-le" or metadata.get("synthetic", False):
            raise ValueError("Unsupported or synthetic training data")
        if self.db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or self.db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Invalid dataset database")
        if self.db.execute("SELECT count(*) FROM samples").fetchone()[0] != row["sample_count"]:
            raise ValueError("Dataset count mismatch")
        leak = self.db.execute("SELECT family_hash FROM samples GROUP BY family_hash HAVING count(DISTINCT split)>1 LIMIT 1").fetchone()
        if leak:
            raise ValueError("Setup family crosses dataset splits")
        self.indices = {split: [r[0] for r in self.db.execute("SELECT id FROM samples WHERE split=? ORDER BY id", (split,))] for split in ("train", "validation", "test")}
        self.supported_seats = [r[0] for r in self.db.execute("SELECT DISTINCT player_count FROM samples WHERE split='train' ORDER BY player_count")]

    def batch(self, ids):
        if not ids or len(ids) > 512:
            raise ValueError("Invalid batch size")
        rows = self.db.execute("SELECT * FROM samples WHERE id IN (" + ",".join("?" for _ in ids) + ") ORDER BY id", [int(i) for i in ids]).fetchall()
        if len(rows) != len(ids):
            raise ValueError("Missing samples")
        x = np.stack([np.frombuffer(r["features"], dtype="<f4") for r in rows])
        y = np.asarray([[r["target0"], r["target1"], r["target2"]] for r in rows], dtype=np.float32)
        counts = np.asarray([r["player_count"] for r in rows])
        present = np.arange(3)[None, :] < counts[:, None]
        weights = np.asarray([r["sample_weight"] for r in rows], dtype=np.float32)
        if x.shape[1] != FEATURE_COUNT or not np.isfinite(x).all() or not np.isfinite(y).all() or not np.isfinite(weights).all() or (weights <= 0).any() or (abs(x) > 1.000001).any() or (y < 0).any() or not np.allclose(y.sum(axis=1), 1) or np.any(y[~present] != 0):
            raise ValueError("Invalid feature, target or mask")
        return torch.from_numpy(x), torch.from_numpy(y), torch.from_numpy(present), torch.from_numpy(weights)

    def close(self):
        self.db.close()


def network(hidden):
    if hidden == 0:
        return nn.Sequential(nn.Linear(FEATURE_COUNT, 3))
    return nn.Sequential(nn.Linear(FEATURE_COUNT, hidden), nn.ReLU(), nn.Linear(hidden, hidden), nn.ReLU(), nn.Linear(hidden, 3))


def losses(logits, targets, present):
    logp = torch.log_softmax(logits.masked_fill(~present, -torch.inf), dim=1)
    # Avoid the padded seat's 0 * -inf -> NaN, even before reduction.
    return -(targets * logp.masked_fill(~present, 0)).sum(dim=1)


def metrics(model, dataset, split, batch_size):
    sums = {"all": [0.0, 0.0, 0.0, 0]}
    model.eval()
    with torch.no_grad():
        for at in range(0, len(dataset.indices[split]), batch_size):
            x, y, present, weights = dataset.batch(dataset.indices[split][at:at + batch_size])
            logits = model(x)
            ce = losses(logits, y, present)
            probs = torch.softmax(logits.masked_fill(~present, -torch.inf), dim=1)
            brier = ((probs - y) ** 2).sum(dim=1)
            for count in (None, 2, 3):
                mask = torch.ones(len(x), dtype=torch.bool) if count is None else present.sum(dim=1) == count
                key = "all" if count is None else str(count)
                agg = sums.setdefault(key, [0.0, 0.0, 0.0, 0])
                agg[0] += float((ce[mask] * weights[mask]).sum())
                agg[1] += float((brier[mask] * weights[mask]).sum())
                agg[2] += float(weights[mask].sum())
                agg[3] += int(mask.sum())
    return {key: {"crossEntropy": v[0] / v[2], "brier": v[1] / v[2], "positions": v[3]} for key, v in sums.items() if v[2] > 0}


def export(model, dataset, out, args, history, validation):
    blocks, layers = [], []
    for module in model:
        if isinstance(module, nn.Linear):
            blocks.extend([module.weight.detach().numpy().astype("<f4").tobytes(), module.bias.detach().numpy().astype("<f4").tobytes()])
            layers.append({"input": module.in_features, "output": module.out_features, "activation": "relu"})
    layers[-1]["activation"] = "linear"
    binary = b"".join(blocks)
    digest = hashlib.sha256(binary).hexdigest()
    weights_file = f"weights-{digest[:16]}.bin"
    (out / weights_file).write_bytes(binary)
    manifest = {
        "formatVersion": 1, "modelId": f"ml-pilot-{digest[:12]}", "featureVersion": FEATURE_VERSION,
        "inputSize": FEATURE_COUNT, "supportedSeats": dataset.supported_seats, "weightsFile": weights_file,
        "weightsSha256": digest, "layers": layers, "learnedWeight": args.learned_weight,
        "training": {"status": "pilot-unvalidated", "datasetManifestHash": dataset.manifest["source_manifest_hash"],
                     "datasetSha256": file_hash(dataset.path), "seed": args.seed, "hidden": args.hidden,
                     "torchVersion": torch.__version__, "numpyVersion": np.__version__,
                     "trainPositions": len(dataset.indices["train"]), "validation": validation,
                     "epochs": len(history), "config": {k: v for k, v in vars(args).items() if k not in ("data", "out", "resume")}},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    fixture_ids = (dataset.indices["validation"] + dataset.indices["train"])[:3]
    x, _, _, _ = dataset.batch(fixture_ids)
    with torch.no_grad():
        logits = model(x).tolist()
    (out / "parity.json").write_text(json.dumps({"modelId": manifest["modelId"], "inputs": x.tolist(), "logits": logits}) + "\n")
    (out / "training.json").write_text(json.dumps({"manifest": manifest, "curves": history, "validation": validation}, indent=2) + "\n")
    return manifest


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--hidden", type=int, default=128, choices=(0, 32, 64, 128, 256))
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--learned-weight", type=float, default=0.5)
    parser.add_argument("--resume")
    args = parser.parse_args()
    if not 1 <= args.epochs <= 10000 or not 1 <= args.batch_size <= 512 or not 1 <= args.threads <= 16 or not 0 <= args.learned_weight <= 1:
        parser.error("Invalid training configuration")
    out = Path(args.out)
    if out.exists() and any(out.iterdir()) and not args.resume:
        parser.error("Output directory exists; use a new path or explicit --resume")
    out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(args.threads)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(args.seed)
    data = Dataset(args.data)
    try:
        if not data.indices["train"] or not data.indices["validation"]:
            raise ValueError("Need independent train and validation families; generate more seeds")
        model = network(args.hidden)
        optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
        best, best_state, bad_epochs, history, start = float("inf"), None, 0, [], 0
        if args.resume:
            saved = torch.load(args.resume, map_location="cpu", weights_only=True)
            if saved["datasetHash"] != data.manifest["source_manifest_hash"] or saved["hidden"] != args.hidden or saved["seed"] != args.seed:
                raise ValueError("Resume data/model/seed mismatch")
            model.load_state_dict(saved["model"])
            optimizer.load_state_dict(saved["optimizer"])
            best, best_state, bad_epochs, history, start = saved["best"], saved["bestState"], saved["badEpochs"], saved["history"], saved["epoch"] + 1
        for epoch in range(start, args.epochs):
            model.train()
            indices = np.random.default_rng(args.seed + epoch).permutation(data.indices["train"])
            for at in range(0, len(indices), args.batch_size):
                x, y, present, weights = data.batch(indices[at:at + args.batch_size].tolist())
                optimizer.zero_grad(set_to_none=True)
                loss = (losses(model(x), y, present) * weights).sum() / weights.sum()
                if not torch.isfinite(loss):
                    raise ValueError("Nonfinite training loss")
                loss.backward()
                optimizer.step()
            validation = metrics(model, data, "validation", args.batch_size)
            ce = validation["all"]["crossEntropy"]
            history.append({"epoch": epoch + 1, "train": metrics(model, data, "train", args.batch_size), "validation": validation})
            print(json.dumps(history[-1]), file=sys.stderr)
            if ce < best - 1e-6:
                best = ce
                best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
                bad_epochs = 0
            else:
                bad_epochs += 1
            checkpoint = {"model": model.state_dict(), "optimizer": optimizer.state_dict(), "best": best, "bestState": best_state,
                          "badEpochs": bad_epochs, "history": history, "epoch": epoch, "hidden": args.hidden,
                          "seed": args.seed, "datasetHash": data.manifest["source_manifest_hash"]}
            torch.save(checkpoint, out / "checkpoint.partial")
            (out / "checkpoint.partial").replace(out / "checkpoint.pt")
            if bad_epochs >= 5:
                break
        if best_state is None:
            raise ValueError("No trained checkpoint")
        model.load_state_dict(best_state)
        validation = metrics(model, data, "validation", args.batch_size)
        manifest = export(model, data, out, args, history, validation)
        print(json.dumps({"modelId": manifest["modelId"], "manifest": str(out / "manifest.json"), "validation": validation}))
    finally:
        data.close()


if __name__ == "__main__":
    main()
