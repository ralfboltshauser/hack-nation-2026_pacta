"""Recreate the final side-by-side/overlay and print reference-fit measurements."""

import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT / "reference.png"
RENDER = ROOT / "robot_head_render.png"


def load_rgb(path):
    size = subprocess.check_output(
        ["identify", "-format", "%w %h", str(path)], text=True
    ).split()
    width, height = map(int, size)
    raw = subprocess.check_output(
        ["convert", str(path), "-alpha", "off", "-depth", "8", "rgb:-"]
    )
    return np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)


subprocess.run(
    ["convert", str(REFERENCE), str(RENDER), "+append", str(ROOT / "final_comparison.png")],
    check=True,
)
subprocess.run(
    [
        "composite",
        "-dissolve",
        "50",
        str(RENDER),
        str(REFERENCE),
        str(ROOT / "final_overlay.png"),
    ],
    check=True,
)

reference = load_rgb(REFERENCE)
render = load_rgb(RENDER)
if reference.shape != render.shape:
    raise SystemExit(f"Size mismatch: reference={reference.shape}, render={render.shape}")

delta = reference.astype(np.float64) - render.astype(np.float64)
mae = np.mean(np.abs(delta))
rmse = np.sqrt(np.mean(delta * delta))


def dark_bbox(image, cutoff=90):
    mask = image.mean(axis=2) < cutoff
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


print(f"canvas: {render.shape[1]}x{render.shape[0]}")
print(f"background RGB: {tuple(int(v) for v in render[0, 0])}")
print(f"reference face bbox: {dark_bbox(reference)}")
print(f"render face bbox:    {dark_bbox(render)}")
print(f"RGB MAE:  {mae:.4f}")
print(f"RGB RMSE: {rmse:.4f}")
