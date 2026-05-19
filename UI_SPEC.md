# UI Specification — Account Registration Automation Dashboard

## Overview

This is a **desktop web UI** (runs locally on localhost) for managing an automated account registration system. The backend is an existing **Node.js application** — do NOT rewrite it. The UI communicates with a new lightweight **REST API** that wraps the existing SQLite database and process management.

The UI must be **minimalist, dark-themed, clean**. No heavy animations, no clutter. Think terminal-inspired dashboard.

---

## Tech Stack

- **Frontend**: React + Tailwind CSS (dark theme)
- **Backend API**: Express.js (Node.js) — wraps existing SQLite DB at `./data/accounts.db`
- **Database**: SQLite via `better-sqlite3` (already exists, do not recreate)
- **Process management**: The API starts/stops `node src/index.js` as a child process

---

## Application Structure — 5 Tabs

### Tab 1: Dashboard (Home)

**Purpose**: Overview + quick controls

**Elements:**
- Stats cards (4 cards in a row):
  - `Emails in queue` — count of `available` emails
  - `Registered` — count of `registered` emails
  - `Failed` — count of `failed` emails
  - `Proxies available` — count of `available` proxies
- **Start / Stop button** — starts or stops `node src/index.js`
  - Green "▶ Start" when stopped
  - Red "■ Stop" when running
- **Accounts to register** — number input (1–100), limits how many accounts to process in this run
- **Parallel workers** — number input (1–10), sets CONCURRENCY before start (default: 1)
- **Headless mode** — toggle switch, sets HEADLESS before start
- **Status indicator** — "Running" / "Stopped" / "Error" with colored dot
- **Recent activity** — last 10 log lines (auto-refresh every 3 seconds)

---

### Tab 2: Logs

**Purpose**: Real-time log viewer

**Elements:**
- Full log stream from `logs/YYYY-MM-DD.log` (today's log)
- Auto-scroll to bottom (toggle button to pause)
- Color coding:
  - `info` → white
  - `warn` → yellow
  - `error` → red
  - Lines containing `✓ Registration successful` → green highlight
  - Lines containing `proxy` error → orange highlight
- **Filter buttons**: All / Info / Warn / Error
- **Clear display** button (does not delete log file)

---

### Tab 3: Accounts

**Purpose**: Manage GMX email accounts

**Elements:**
- Table with columns: ID, Email, Status, Attempts, Added
- Status badges with colors:
  - `available` → blue
  - `in_progress` → yellow
  - `registered` → green
  - `failed` → red
  - `parked` → gray
- **Add accounts** — textarea input, one `email:password` per line, submit button
- **Reset Failed** button — resets all `failed` → `available`
- **Export Registered** button — downloads `registered.txt` with `email:password` lines
- Pagination (50 per page)

---

### Tab 4: Proxies

**Purpose**: Manage two separate proxy pools

**Two sections side by side:**

#### Browser Proxies (AdsPower)
- Table: ID, Host, Port, User, Status
- Status badges: `available` (blue), `in_use` (yellow), `used` (gray), `failed` (red)
- **Add proxies** textarea — supports formats:
  - `host:port:user:pass`
  - `socks5://user:pass@host:port`
- **Reset Failed** button
- **Clear Used** button — deletes `used` proxies to free space

#### IMAP Proxies (Email reading, round-robin)
- Table: ID, Protocol, Host, Port, User
- **Add proxies** textarea — same formats
- **Delete** button per row
- Total count shown

---

### Tab 5: Settings

**Purpose**: Configuration management

**Sections:**

#### Paths
- `Cookies directory` — text input, default `./cookies`
- `Database path` — text input, default `./data/accounts.db` (read-only display)
- `Log directory` — display only

#### Registration Settings
- `Max retries` — number input (default: 3)
- `Email timeout (ms)` — number input (default: 180000)
- `Playwright timeout (ms)` — number input (default: 30000)
- `Concurrency` — number input (default: 1), how many parallel workers
- `Headless mode` — toggle switch (default: ON)
  - ON = browser runs hidden (no window on screen)
  - OFF = browser visible (for debugging)

#### AdsPower Settings
- `API URL` — text input (default: `http://local.adspower.net:50325`)
- `Group ID` — text input

#### Email Filter
- `Sender pattern` — text input (default: `lumalabs.ai`)
- `Code regex` — text input (default: `\d{4,8}`)

**Save Settings** button — writes to `.env` file

---

## REST API Endpoints (to be created in `src/api.js`)

```
GET  /api/stats              — dashboard stats
GET  /api/emails             — list emails (paginated)
POST /api/emails/import      — add emails from text
POST /api/emails/reset-failed — reset failed emails
GET  /api/emails/export-registered — download registered as txt

GET  /api/proxies            — list browser proxies
POST /api/proxies/import     — add browser proxies
POST /api/proxies/reset-failed
POST /api/proxies/clear-used

GET  /api/imap-proxies       — list IMAP proxies
POST /api/imap-proxies/import
DELETE /api/imap-proxies/:id

GET  /api/logs               — last N lines of today's log
GET  /api/logs/stream        — SSE stream for real-time logs

GET  /api/status             — worker running/stopped
POST /api/start              — start worker (with optional count param)
POST /api/stop               — stop worker

GET  /api/settings           — read .env values (TARGET_URL, CONCURRENCY, HEADLESS, MAX_RETRIES, EMAIL_TIMEOUT_MS, PLAYWRIGHT_TIMEOUT_MS, ADSPOWER_API_URL, ADSPOWER_GROUP_ID, CAPSOLVER_API_KEY, EMAIL_SENDER_PATTERN, CODE_REGEX, COOKIES_DIR)
POST /api/settings           — write .env values
```

---

## Important Constraints

1. **Do NOT modify** `src/worker.js`, `src/index.js`, `src/database/sqlite.js`, or any existing service files
2. **Create new files only**: `src/api.js` (Express API server), `src/ui/` (React app)
3. The API server runs on **port 3001**, the React dev server on **port 3000**
4. Use the existing `better-sqlite3` database — do not create a new one
5. Worker process is started via `child_process.spawn('node', ['src/index.js'])`
6. All proxy errors in logs should be clearly visible (orange/red color)
7. Cookie files are named `{email}.json` and stored in `COOKIES_DIR`

---

## Visual Style

- **Dark background**: `#0f0f0f` or `#111111`
- **Card background**: `#1a1a1a`
- **Border**: `#2a2a2a`
- **Text**: `#e0e0e0`
- **Accent**: `#3b82f6` (blue)
- **Success**: `#22c55e` (green)
- **Error**: `#ef4444` (red)
- **Warning**: `#f59e0b` (yellow)
- **Font**: monospace for logs, sans-serif for UI
- No rounded corners on tables, subtle rounded on cards
- Compact density — show maximum information without scrolling

---

## Packaging — Electron Desktop App + Installer

The entire application (Node.js backend + React UI) must be packaged as a **Windows desktop application** using **Electron**.

### Requirements:

1. **Electron wrapper** — wraps the Express API server + React UI into a single desktop app
2. **Windows installer** — built with `electron-builder` as NSIS installer (`.exe`)
   - User can choose installation directory during setup
   - Creates desktop shortcut and Start Menu entry
   - App name: `Luma Registration Bot`
   - Single executable installer: `LumaBot-Setup-1.0.0.exe`
3. **Auto-start** — on app launch, automatically starts the Express API server internally
4. **Tray icon** — app minimizes to system tray, not taskbar
5. **No console window** — runs silently in background

### Build command:
```
npm run build:electron   # builds React + packages with Electron
npm run dist             # creates Windows installer
```

### electron-builder config (in package.json):
```json
{
  "build": {
    "appId": "com.lumabot.registration",
    "productName": "Luma Registration Bot",
    "win": {
      "target": "nsis",
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowDirChange": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "files": ["dist/**", "src/**", "node_modules/**", "data/**", "config/**"],
    "extraResources": [{"from": "config/.env.example", "to": ".env.example"}]
  }
}
```



Before building, read `PROJECT_KNOWLEDGE.md` in the repository root — it contains the full architecture, database schema, and all service descriptions.
