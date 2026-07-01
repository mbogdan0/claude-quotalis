# Quotalis for Claude

Quotalis is a tiny Chrome extension that shows your Claude.ai usage limits before you hit the quota wall.

![Quotalis for Claude usage popup](quotalis-claude-usage-popup.jpg)

## What it does

- 📊 **Usage meter** — session, weekly, and Opus weekly usage, live from Claude.
- ⏱️ **Reset countdown** — see exactly when each limit refreshes.
- 🏷️ **Toolbar badge** — remaining % at a glance, color-coded as quota tightens.
- 📅 **Weekly forecast** — a 7-day pace strip for your remaining weekly quota (see below).
- 🔄 **Auto-refresh** — updates locally on a short interval, no accounts, no cloud.

## Weekly forecast

A 7-day strip that splits your remaining weekly quota evenly across the days left until reset, so you always know today's fair share.

**How the split is calculated:**

1. 🔢 Your remaining weekly % is converted into remaining 5-hour windows, using your `5h windows/week` capacity estimate.
2. 📆 Quotalis counts the usable days left until reset — starting today (or tomorrow if `Done today` is on), skipping weekends unless `Work weekends` is on.
3. ➗ The remaining windows are divided evenly across those usable days — that's your daily budget.
4. 🧮 If your daily budget is already ahead of the flat weekly average, the strip backs off the warning color — you have buffer, no need to worry.

**What you see and control:**

- 🗓️ Cell states: past days faded, today highlighted, future days outlined, weekends/excluded days dashed.
- 🖱️ Hover any day for its exact budget (`~N × 5h windows`).
- ⚙️ **Settings** (gear icon): `5h windows/week` · `Work weekends` · `Done today` (skip today, resets at midnight).
- ⚠️ Visual pacing only — it never changes the real numbers Claude reports.
- 📄 **Full history log** — download the complete usage history as CSV (download icon next to the strip) whenever the pace strip isn't enough and you want to dig into the raw numbers yourself.

## Languages

Quotalis currently supports:

- Chinese (Simplified)
- English
- French
- German
- Indonesian
- Italian
- Japanese
- Portuguese (Brazil)
- Spanish
- Thai
- Ukrainian
- Vietnamese

## Privacy

Quotalis uses the minimum permissions needed for this job:

- `cookies` to read the active Claude.ai browser session.
- `alarms` to refresh usage in the background.
- `storage` to keep normalized usage data and the rolling quota log locally.
- `https://claude.ai/*` as the only host permission.

The extension sends Claude cookies only to Claude API endpoints under `https://claude.ai/api/...`. It does not use analytics, remote scripts, third-party APIs, tab access, browsing history, the Chrome downloads permission/API, clipboard access, native messaging, or broad host permissions.

Stored data is limited to normalized usage percentages, reset timestamps, the active Claude organization id, which Claude endpoint the numbers came from, a last-updated timestamp, and a rolling quota log capped at the latest 3000 entries. CSV log exports are generated locally from extension storage. The data is not sold, shared, uploaded, or made exciting.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the project folder.

You need to be signed into Claude.ai in the same browser — Quotalis reads that existing session and nothing else.

## Build

```sh
npm run build
```

The build script creates a Chrome Web Store ZIP in `dist/` using the current `manifest.json` version, for example `dist/quotalis-for-claude-1.0.0.zip`. It includes only the publishable extension files and locale message files.

## Release package

```sh
npm run release -- 1.1.0
```

The release script updates `manifest.json` and `package.json` to the requested version, builds the versioned ZIP, and runs verification.

## Verify

```sh
npm run verify
```

The verification script checks the manifest, JavaScript syntax, publishable URLs, forbidden extension APIs, dynamic-code patterns, and the generated ZIP contents. It is not a formal security audit, but it is a useful guardrail against accidentally shipping something weird.
