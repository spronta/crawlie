#!/usr/bin/env python3
"""Regenerate the crawlie app icon from the canonical brand mark.

The single source of truth is the site favicon (the crawl-graph mark):
    apps/website/public/favicon.svg

This renders it to a 1024x1024 source.png, then you run:
    pnpm tauri icon icons/source.png
to produce the full platform icon set (.icns, .ico, PNGs, iOS, Android).

Requires rsvg-convert (`brew install librsvg`) for crisp, anti-aliased output.
"""
import pathlib
import subprocess

here = pathlib.Path(__file__).parent
favicon = (here / "../../../website/public/favicon.svg").resolve()
out = here / "source.png"

subprocess.run(
    ["rsvg-convert", "-w", "1024", "-h", "1024", str(favicon), "-o", str(out)],
    check=True,
)
print(f"wrote {out} from {favicon}")
print("now run:  pnpm tauri icon icons/source.png")
