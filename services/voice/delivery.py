"""Listener delivery journal. No audio/device/model imports; testable with stdlib only.

Acknowledgement, not a successful socket write, removes a pending request. The Hub's
retention policy also applies here. Failed requests require an explicit retry at the Hub;
reconnecting must never repeatedly run a request rejected by policy or transcription.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import threading
import time


class DeliveryJournal:
    def __init__(self, path, now=time.time):
        self.path = Path(path)
        self.now = now
        self.lock = threading.RLock()
        self.policy = {"mode": "off", "days": 7, "deviceMb": 50}
        self.items = {}
        self.error = None
        try:
            saved = json.loads(self.path.read_text(encoding="utf-8"))
            self.policy.update(saved.get("policy", {}))
            for key, row in saved.get("items", {}).items():
                if (re.fullmatch(r"[A-Za-z0-9_-]{6,64}", key) and isinstance(row.get("message"), dict)
                        and isinstance(row.get("at"), (int, float)) and row.get("status") in ("pending", "failed", "done")):
                    self.items[key] = {**row, "sentAt": 0}
                else:
                    raise ValueError("registro de fala inválido")
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError, AttributeError):
            self.error = "Registro local de falas ilegível. Preserve o arquivo e revise a recuperação antes de gravar novamente."

    def _save(self):
        if self.error:
            raise RuntimeError(self.error)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        # Keep policy even when off, so a restart cannot silently enable audio retention.
        value = {"policy": self.policy, "items": self.items if self.policy["mode"] != "off" else {}}
        with temporary.open("w", encoding="utf-8") as fh:
            json.dump(value, fh)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, self.path)

    def configure(self, policy):
        with self.lock:
            if self.error:
                return
            self.policy = {"mode": policy.get("mode", "until_done"),
                           "days": max(1, min(90, int(policy.get("days", 7)))),
                           "deviceMb": max(5, min(2000, int(policy.get("deviceMb", 50))))}
            if self.policy["mode"] not in ("off", "days", "until_done"):
                self.policy["mode"] = "until_done"
            self._sweep()
            self._save()

    def _sweep(self):
        before = len(self.items)
        cutoff = self.now() - self.policy["days"] * 86400
        self.items = {k: v for k, v in self.items.items() if v["at"] >= cutoff
                      and not (v["status"] == "done" and self.policy["mode"] != "days")}
        return len(self.items) != before

    def put(self, message):
        key = message.get("vtid", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,64}", key):
            raise ValueError("fala sem identificador válido")
        with self.lock:
            if self.error:
                raise RuntimeError(self.error)
            self._sweep()
            if key in self.items:
                return
            size = len(json.dumps(message).encode("utf-8"))
            used = sum(len(json.dumps(v["message"]).encode("utf-8")) for v in self.items.values())
            if used + size > self.policy["deviceMb"] * 1024 * 1024:
                raise RuntimeError("fila de voz cheia; resolva as falas pendentes antes de gravar outra")
            self.items[key] = {"message": message, "at": self.now(), "status": "pending", "sentAt": 0}
            try:
                self._save()
            except OSError:
                self.items.pop(key, None)
                raise

    def flush(self, send):
        # Send without the lock: an immediate acknowledgement may arrive on another thread.
        with self.lock:
            if self.error:
                return
            if self._sweep():
                self._save()
            due = [(k, v["message"]) for k, v in self.items.items()
                   if v["status"] == "pending" and self.now() - v.get("sentAt", 0) >= 10]
        for key, message in due:
            if send(message):
                with self.lock:
                    if key in self.items:
                        self.items[key]["sentAt"] = self.now()

    def received(self, message):
        key = message.get("vtid")
        with self.lock:
            row = self.items.get(key)
            if not row:
                return False
            if message.get("t") == "voice_ack":
                if self.policy["mode"] == "days":
                    row["status"] = "done"
                else:
                    self.items.pop(key)
            elif message.get("t") == "voice_failed":
                row["status"] = "failed"
                row["error"] = str(message.get("message") or "Falha de voz")[:300]
                if message.get("kept") or self.policy["mode"] == "off":
                    # The Hub owns the recoverable copy, or retaining audio was forbidden.
                    self.items.pop(key)
            else:
                return False
            self._save()
            return True

    def retry_failed(self):
        """Explicit owner retry only; keep the original IDs for Hub deduplication."""
        with self.lock:
            if self.error:
                raise RuntimeError(self.error)
            self._sweep()
            before = {k: dict(v) for k, v in self.items.items()}
            for row in self.items.values():
                if row["status"] == "failed":
                    row.update(status="pending", sentAt=0)
            try:
                self._save()
            except OSError:
                self.items = before
                raise

    def status(self):
        with self.lock:
            return {"pending": sum(v["status"] == "pending" for v in self.items.values()),
                    "failed": sum(v["status"] == "failed" for v in self.items.values()),
                    **({"error": self.error} if self.error else {})}


def clean_processing_audio(directory, now=time.time):
    """Only our abandoned processing copies; never user files or the retention journal.

    A one-hour grace avoids removing a clip still in use by another listener/STT process.
    """
    for path in Path(directory).glob("jarvis_wake_*.wav"):
        if not re.fullmatch(r"jarvis_wake_[0-9a-f_-]+\.wav", path.name):
            continue
        try:
            if not path.is_symlink() and now() - path.stat().st_mtime > 3600:
                path.unlink()
        except OSError:
            pass
