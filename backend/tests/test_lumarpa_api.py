"""Pytest suite for LUMARPA Express REST API (node src/api.js on :3001)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("LUMARPA_API_URL", "http://127.0.0.1:3001").rstrip("/")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ─── Health ─────────────────────────────────────────────────────
class TestHealth:
    def test_health(self, api):
        r = api.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert "db" in d and "logs" in d


# ─── Stats / Status / Settings basics ───────────────────────────
class TestBasics:
    def test_stats_shape(self, api):
        r = api.get(f"{BASE_URL}/api/stats")
        assert r.status_code == 200
        d = r.json()
        for k in ["emailsAvailable", "emailsRegistered", "emailsFailed",
                  "emailsTotal", "proxiesAvailable", "imapProxiesTotal",
                  "registrationsTotal"]:
            assert k in d, f"missing {k}"
            assert isinstance(d[k], int)

    def test_status_stopped(self, api):
        r = api.get(f"{BASE_URL}/api/status")
        assert r.status_code == 200
        d = r.json()
        assert "running" in d and "status" in d
        assert d["status"] in ("stopped", "running", "error")

    def test_settings_get(self, api):
        r = api.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        d = r.json()
        # required keys present (may be empty strings)
        for k in ["TARGET_URL", "CAPSOLVER_API_KEY", "ADSPOWER_API_URL",
                  "MAX_RETRIES", "CONCURRENCY", "HEADLESS",
                  "CODE_REGEX", "EMAIL_SENDER_PATTERN"]:
            assert k in d

    def test_settings_save_and_persist(self, api):
        marker = f"TEST_VAL_{int(time.time())}"
        r = api.post(f"{BASE_URL}/api/settings", json={"CODE_REGEX": marker})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # verify persisted
        r2 = api.get(f"{BASE_URL}/api/settings")
        assert r2.json()["CODE_REGEX"] == marker


# ─── Emails CRUD ────────────────────────────────────────────────
class TestEmails:
    def test_import_valid(self, api):
        payload = {"text": "TEST_user1@x.com:pw1\nTEST_user2@x.com:pw2\n# comment\nbadline\n"}
        r = api.post(f"{BASE_URL}/api/emails/import", json=payload)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["total"] == 2

    def test_import_invalid_empty(self, api):
        r = api.post(f"{BASE_URL}/api/emails/import", json={"text": "noformatlines\n"})
        assert r.status_code == 400
        assert "error" in r.json()

    def test_list_emails(self, api):
        r = api.get(f"{BASE_URL}/api/emails?page=1&limit=10")
        assert r.status_code == 200
        d = r.json()
        assert "rows" in d and "total" in d
        assert isinstance(d["rows"], list)
        assert d["page"] == 1
        assert d["limit"] == 10
        if d["rows"]:
            row = d["rows"][0]
            for k in ["id", "email", "password", "status", "attempts"]:
                assert k in row

    def test_list_emails_filter(self, api):
        r = api.get(f"{BASE_URL}/api/emails?status=available&limit=5")
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["status"] == "available"

    def test_reset_failed(self, api):
        r = api.post(f"{BASE_URL}/api/emails/reset-failed")
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert "changed" in d

    def test_export_registered(self, api):
        r = api.get(f"{BASE_URL}/api/emails/export-registered")
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("text/plain")
        assert "attachment" in r.headers.get("Content-Disposition", "")


# ─── Proxies ─────────────────────────────────────────────────────
class TestProxies:
    def test_import_mixed_formats(self, api):
        text = "1.2.3.4:1080:user:pass\nsocks5://u:p@5.6.7.8:1080\n"
        r = api.post(f"{BASE_URL}/api/proxies/import", json={"text": text})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["total"] == 2

    def test_import_empty(self, api):
        r = api.post(f"{BASE_URL}/api/proxies/import", json={"text": ""})
        assert r.status_code == 400

    def test_list(self, api):
        r = api.get(f"{BASE_URL}/api/proxies?page=1&limit=10")
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["rows"], list)
        assert "total" in d

    def test_reset_failed(self, api):
        r = api.post(f"{BASE_URL}/api/proxies/reset-failed")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_clear_used(self, api):
        r = api.post(f"{BASE_URL}/api/proxies/clear-used")
        assert r.status_code == 200
        assert r.json()["ok"] is True
        assert "deleted" in r.json()


# ─── IMAP Proxies ───────────────────────────────────────────────
class TestImapProxies:
    def test_import_and_list_and_delete(self, api):
        text = "10.20.30.40:1080:user:pass\n"
        r = api.post(f"{BASE_URL}/api/imap-proxies/import", json={"text": text})
        assert r.status_code == 200
        assert r.json()["ok"] is True

        r2 = api.get(f"{BASE_URL}/api/imap-proxies")
        assert r2.status_code == 200
        rows = r2.json()["rows"]
        assert isinstance(rows, list)
        target = next((x for x in rows if x["host"] == "10.20.30.40" and x["port"] == 1080), None)
        if target:
            r3 = api.delete(f"{BASE_URL}/api/imap-proxies/{target['id']}")
            assert r3.status_code == 200
            assert r3.json()["ok"] is True


# ─── Logs ───────────────────────────────────────────────────────
class TestLogs:
    def test_logs_get(self, api):
        r = api.get(f"{BASE_URL}/api/logs?lines=50")
        assert r.status_code == 200
        d = r.json()
        assert "lines" in d
        assert isinstance(d["lines"], list)


# ─── Worker lifecycle ───────────────────────────────────────────
class TestWorker:
    def test_start_then_status_error(self, api):
        """Worker should fail (missing TARGET_URL/CAPSOLVER) -> status='error'."""
        # ensure stopped first
        api.post(f"{BASE_URL}/api/stop")
        time.sleep(0.5)

        r = api.post(f"{BASE_URL}/api/start",
                     json={"concurrency": 1, "headless": True, "count": 1})
        # Either ok=True or already running
        assert r.status_code in (200, 400)

        # wait for process to crash (missing env vars)
        time.sleep(3.0)
        s = api.get(f"{BASE_URL}/api/status").json()
        # expected behaviour: worker crashed -> status error
        assert s["status"] in ("error", "stopped"), f"unexpected status {s}"

    def test_stop_when_not_running(self, api):
        # ensure stopped
        time.sleep(0.5)
        s = api.get(f"{BASE_URL}/api/status").json()
        if not s["running"]:
            r = api.post(f"{BASE_URL}/api/stop")
            assert r.status_code == 400  # not running


# ─── Static UI ──────────────────────────────────────────────────
class TestUI:
    def test_index_html_served(self, api):
        r = api.get(f"{BASE_URL}/")
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype html" in r.text.lower()

    def test_spa_fallback(self, api):
        r = api.get(f"{BASE_URL}/some/unknown/route")
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype html" in r.text.lower()
