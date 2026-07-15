"""
Speaker-ID CLI the Hub (Node) shells out to. Emits ONE JSON object on stdout.

Usage:
    python voice_cli.py enroll --name jonathan a.wav b.wav c.wav
    python voice_cli.py identify utterance.webm [--threshold 0.75]
    python voice_cli.py list
    python voice_cli.py delete --name jonathan

Keep stdout JSON-only: model/torch chatter goes to stderr, and the Node side reads
the last JSON object on stdout defensively.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voiceprints as vp  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Jarvis local speaker identification")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enroll")
    e.add_argument("--name", required=True)
    e.add_argument("wavs", nargs="+")

    i = sub.add_parser("identify")
    i.add_argument("wav")
    i.add_argument("--threshold", type=float, default=None)

    sub.add_parser("list")

    d = sub.add_parser("delete")
    d.add_argument("--name", required=True)

    a = ap.parse_args()
    if a.cmd == "enroll":
        out = vp.enroll(a.name, a.wavs)
    elif a.cmd == "identify":
        out = vp.identify(a.wav, a.threshold)
    elif a.cmd == "list":
        out = {"speakers": vp.list_names()}
    elif a.cmd == "delete":
        out = {"deleted": vp.delete(a.name), "name": a.name}
    else:  # pragma: no cover
        out = {"error": "unknown command"}

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
