# Quotalis for Claude

Quotalis is a tiny Chrome extension for people who would rather know their Claude.ai usage limits before a conversation disappears into the quota wall.

There are already bigger usage trackers on the market. This one is intentionally not trying to become a dashboard, a productivity platform, or a suspiciously enthusiastic SaaS funnel. I built it for myself because I wanted a quiet meter, a pinned badge, and fewer surprises.

Open source: [github.com/mbogdan0/claude-quotalis](https://github.com/mbogdan0/claude-quotalis)

![Quotalis for Claude screenshot](img.jpg)

## What it does

- Shows Claude session, weekly, and Opus weekly usage when Claude returns those values.
- Displays reset timing in a compact popup.
- Updates the toolbar badge with remaining session percentage.
- Refreshes locally on a short interval.
- Keeps the interface boring in the best possible way.

## Privacy

Quotalis uses the minimum permissions needed for this job:

- `cookies` to read the active Claude.ai browser session.
- `alarms` to refresh usage in the background.
- `storage` to keep normalized usage data locally.
- `https://claude.ai/*` as the only host permission.

The extension sends Claude cookies only to Claude API endpoints under `https://claude.ai/api/...`. It does not use analytics, remote scripts, third-party APIs, tab access, browsing history, downloads, clipboard access, native messaging, or broad host permissions.

Stored data is limited to normalized usage percentages, reset timestamps, the detected plan label, and the active Claude organization id. It is not sold, shared, uploaded, or made exciting.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the project folder.

## Build

```sh
npm run build
```

The build script creates a Chrome Web Store ZIP in `dist/` and includes only the publishable extension files.

## Verify

```sh
npm run verify
```

The verification script checks the manifest, JavaScript syntax, publishable URLs, forbidden extension APIs, dynamic-code patterns, and the generated ZIP contents. It is not a formal security audit, but it is a useful guardrail against accidentally shipping something weird.
