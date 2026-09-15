"""Verify the downloaded plant images are valid PNG files."""

import os
import sys
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

FILES = [
    "frontend/public/plants/rose.png",
    "frontend/public/plants/hibiscus.png",
    "frontend/public/plants/aloe-vera.png",
    "frontend/public/plants/money-plant.png",
    "frontend/public/plants/chrysanthemum.png",
    "frontend/public/plants/turmeric.png",
    "frontend/public/plants/grape.png",
    "frontend/public/plants/peach.png",
    "frontend/public/plants/strawberry.png",
]

for path in FILES:
    if not os.path.exists(path):
        print(f"MISS {path}")
        continue
    try:
        with Image.open(path) as im:
            print(f"OK   {os.path.basename(path):22s} {im.format} {im.size[0]}x{im.size[1]} {os.path.getsize(path):>8d} bytes")
    except Exception as e:
        print(f"BAD  {path} -> {e}")