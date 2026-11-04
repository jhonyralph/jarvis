import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).parent))
from delivery import DeliveryJournal, clean_processing_audio


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "pending.json"
        self.now = 1000
        self.j = DeliveryJournal(self.path, lambda: self.now)
        self.j.configure({"mode": "until_done"})
        self.message = {"t": "voice", "vtid": "wk012345", "audio": "audio"}

    def test_failed_socket_and_lost_ack_survive_restart_with_same_id(self):
        self.j.put(self.message)
        self.j.flush(lambda _: False)
        restarted = DeliveryJournal(self.path, lambda: self.now)
        sent = []
        restarted.flush(lambda m: sent.append(m) or True)
        self.assertEqual(sent, [self.message])
        self.assertEqual(restarted.status()["pending"], 1)
        self.now += 11
        restarted.flush(lambda m: sent.append(m) or True)
        self.assertEqual(sent, [self.message, self.message])
        restarted.received({"t": "voice_ack", "vtid": "wk012345"})
        self.assertEqual(DeliveryJournal(self.path).items, {})

    def test_failure_is_visible_and_is_not_automatically_retried(self):
        self.j.put(self.message)
        self.j.received({"t": "voice_failed", "vtid": "wk012345", "message": "STT timeout"})
        self.j.flush(lambda _: self.fail("failed request replayed"))
        self.assertEqual(self.j.status(), {"pending": 0, "failed": 1})

    def test_off_does_not_persist_audio_even_after_policy_change(self):
        self.j.put(self.message)
        self.j.configure({"mode": "off"})
        self.assertNotIn("audio", self.path.read_text())
        self.assertEqual(DeliveryJournal(self.path).items, {})

    def test_owner_retry_preserves_id_and_does_not_resend_completed_audio(self):
        self.j.configure({"mode": "days"})
        self.j.put(self.message)
        self.j.put({**self.message, "vtid": "completed1"})
        self.j.received({"t": "voice_ack", "vtid": "completed1"})
        self.j.received({"t": "voice_failed", "vtid": "wk012345"})
        self.j.retry_failed()
        sent = []
        self.j.flush(lambda m: sent.append(m) or True)
        self.assertEqual(sent, [self.message])

    def test_days_keeps_success_but_does_not_resend_it(self):
        self.j.configure({"mode": "days", "days": 1})
        self.j.put(self.message)
        self.j.received({"t": "voice_ack", "vtid": "wk012345"})
        self.j.flush(lambda _: self.fail("completed request replayed"))
        self.now += 86401
        self.j.configure({"mode": "days", "days": 1})
        self.assertEqual(self.j.items, {})

    def test_disk_error_is_not_reported_as_accepted(self):
        with patch.object(self.j, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.j.put(self.message)
        self.assertEqual(self.j.items, {})

    def test_corrupt_journal_is_visible_and_never_overwritten(self):
        self.path.write_text("broken recording evidence", encoding="utf-8")
        journal = DeliveryJournal(self.path)
        journal.configure({"mode": "until_done"})
        self.assertIn("ilegível", journal.status()["error"])
        with self.assertRaises(RuntimeError):
            journal.put(self.message)
        self.assertEqual(self.path.read_text(), "broken recording evidence")

    def test_idle_retry_loop_expires_retained_audio_on_disk(self):
        self.j.configure({"mode": "days", "days": 1})
        self.j.put(self.message)
        self.j.received({"t": "voice_ack", "vtid": "wk012345"})
        self.now += 86401
        self.j.flush(lambda _: self.fail("expired audio resent"))
        self.assertEqual(DeliveryJournal(self.path).items, {})

    def test_cleanup_preserves_recent_and_unrelated_files(self):
        import os
        old = Path(self.temp.name) / "jarvis_wake_123.wav"
        recent = Path(self.temp.name) / "jarvis_wake_456.wav"
        other = Path(self.temp.name) / "recording.wav"
        for p in (old, recent, other):
            p.write_bytes(b"test")
        os.utime(old, (1, 1))
        clean_processing_audio(self.temp.name)
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(other.exists())


if __name__ == "__main__":
    unittest.main()
