const REFRESH_ALARM = "quotalis-refresh";
const REFRESH_PERIOD_MINUTES = 1;
const CLAUDE_ORIGIN = "https://claude.ai";
const USAGE_LOG_STORAGE_KEY = "usageLog";
const WEEKLY_WINDOW_STORAGE_KEY = "weeklyFiveHourWindows";
const USAGE_LOG_SCHEMA_VERSION = 1;
const USAGE_LOG_LIMIT = 3000;
const USAGE_LOG_TOUCH_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS = 9;
const MIN_WEEKLY_FIVE_HOUR_WINDOWS = 1;
const MAX_WEEKLY_FIVE_HOUR_WINDOWS = 500;

chrome.runtime.onInstalled.addListener(() => {
  scheduleAlarms();
  refreshUsage();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
  refreshUsage();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshUsage();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "refresh") {
    refreshUsage().then(sendResponse);
    return true;
  }

  return false;
});

function scheduleAlarms() {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
}

async function refreshUsage() {
  const result = await readClaudeUsage();
  const stored = await chrome.storage.local.get([
    "usageData",
    USAGE_LOG_STORAGE_KEY,
    WEEKLY_WINDOW_STORAGE_KEY,
  ]);
  const previous = stored.usageData;
  const now = Date.now();

  let usageData;
  let shouldLogUsage = false;
  if (result.error && hasUsableData(previous)) {
    // Keep the last known-good numbers; flag the failed refresh instead of blanking.
    usageData = {
      ...previous,
      lastError: result.error,
      lastErrorHint: result.hint || null,
      lastErrorAt: Date.now(),
    };
  } else {
    usageData = result;
    usageData.lastUpdated = now;
    shouldLogUsage = hasUsableData(usageData);
  }

  const nextStorage = { usageData };
  if (shouldLogUsage) {
    const nextUsageLog = updateUsageLog(
      stored[USAGE_LOG_STORAGE_KEY],
      usageData,
      stored[WEEKLY_WINDOW_STORAGE_KEY],
      now
    );
    if (nextUsageLog !== stored[USAGE_LOG_STORAGE_KEY]) {
      nextStorage[USAGE_LOG_STORAGE_KEY] = nextUsageLog;
    }
  }

  await chrome.storage.local.set(nextStorage);
  updateBadge(usageData);
  return usageData;
}

function hasUsableData(usageData) {
  return Boolean(usageData && !usageData.error && usageData.session);
}

async function readClaudeUsage() {
  const cookieHeader = await getClaudeCookieHeader();

  if (!cookieHeader) {
    return {
      error: message("notSignedIn"),
      hint: message("signInHint"),
    };
  }

  const orgId = await getActiveOrganizationId(cookieHeader);
  const requests = [
    orgId && {
      url: `${CLAUDE_ORIGIN}/api/organizations/${orgId}/usage`,
      source: "organization_usage",
      normalizer: normalizeUsageResponse,
    },
    {
      url: `${CLAUDE_ORIGIN}/api/usage`,
      source: "usage",
      normalizer: normalizeUsageResponse,
    },
    {
      url: `${CLAUDE_ORIGIN}/api/bootstrap`,
      source: "bootstrap",
      normalizer: normalizeBootstrapResponse,
    },
    orgId && {
      url: `${CLAUDE_ORIGIN}/api/organizations/${orgId}/settings/usage`,
      source: "settings_usage",
      normalizer: normalizeUsageResponse,
    },
  ].filter(Boolean);

  for (const request of requests) {
    try {
      const response = await fetchClaudeJson(request.url, cookieHeader);
      if (response.ok) {
        const payload = await response.json();
        return request.normalizer(payload, request.source);
      }
    } catch (_error) {
      // Try the next known Claude usage endpoint.
    }
  }

  return {
    error: message("usageUnavailable"),
    hint: message("usageUnavailableHint"),
  };
}

async function getClaudeCookieHeader() {
  const cookies = await chrome.cookies.getAll({ domain: ".claude.ai" });
  if (!cookies.length) return null;
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function getActiveOrganizationId(cookieHeader) {
  try {
    const cookie = await chrome.cookies.get({
      url: CLAUDE_ORIGIN,
      name: "lastActiveOrg",
    });
    if (cookie?.value) return cookie.value;
  } catch (_error) {
    // Fall back to local cache and the organizations endpoint.
  }

  const stored = await chrome.storage.local.get("orgId");
  if (stored.orgId) return stored.orgId;

  try {
    const response = await fetchClaudeJson(`${CLAUDE_ORIGIN}/api/organizations`, cookieHeader);
    if (!response.ok) return null;

    const organizations = await response.json();
    const orgId = Array.isArray(organizations) ? organizations[0]?.uuid : null;
    if (orgId) {
      await chrome.storage.local.set({ orgId });
      return orgId;
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function fetchClaudeJson(url, cookieHeader) {
  return fetch(url, {
    // host_permissions grant cookied requests to claude.ai; "include" makes the
    // browser attach them reliably (a manual Cookie header is a forbidden, stripped
    // fetch header and cannot be relied on).
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
  });
}

function normalizeUsageResponse(payload, source) {
  const session = normalizeWindow(payload.five_hour);
  const weekly = normalizeWindow(payload.seven_day);
  const weeklyOpus = payload.seven_day_opus ? normalizeWindow(payload.seven_day_opus) : null;

  return {
    session,
    weekly,
    weeklyOpus,
    source,
  };
}

function normalizeBootstrapResponse(payload) {
  const usage = {
    session: { percentage: 0, resetsAt: null },
    weekly: null,
    weeklyOpus: null,
    source: "bootstrap",
  };

  const organization = payload.account?.memberships?.find((membership) => membership.organization)
    ?.organization;

  if (organization) {
    if (organization.uuid) chrome.storage.local.set({ orgId: organization.uuid });
  }

  const messageLimit = payload.message_limit;
  if (messageLimit) {
    usage.session = {
      percentage: messageLimitToPercentage(messageLimit.type),
      resetsAt: messageLimit.resets_at || null,
    };
  }

  return usage;
}

function normalizeWindow(value) {
  return {
    percentage: clampPercentage(Math.round(value?.utilization || 0)),
    resetsAt: value?.resets_at || null,
  };
}

function updateUsageLog(existingLog, usageData, weeklyFiveHourWindows, timestamp = Date.now()) {
  const log = compactUsageLog(Array.isArray(existingLog) ? existingLog : []);
  const entry = createUsageLogEntry(usageData, weeklyFiveHourWindows, timestamp);
  const lastIndex = log.length - 1;
  const lastEntry = lastIndex >= 0 ? log[lastIndex] : null;

  if (lastEntry && usageLogFingerprint(lastEntry) === usageLogFingerprint(entry)) {
    const lastSeenAt = parseLogTimestamp(lastEntry.lastSeenAt || lastEntry.capturedAt);
    if (!Number.isFinite(lastSeenAt) || timestamp - lastSeenAt >= USAGE_LOG_TOUCH_INTERVAL_MS) {
      const nextLog = [...log];
      nextLog[lastIndex] = {
        ...lastEntry,
        lastSeenAt: toLogTimestamp(timestamp),
      };
      return trimUsageLog(nextLog);
    }
    return trimUsageLog(log);
  }

  return trimUsageLog([...log, entry]);
}

function createUsageLogEntry(usageData, weeklyFiveHourWindows, timestamp = Date.now()) {
  const session = normalizeLogWindow(usageData?.session);
  const weekly = normalizeLogWindow(usageData?.weekly);
  const weeklyOpus = normalizeLogWindow(usageData?.weeklyOpus);
  const capturedAt = toLogTimestamp(timestamp);

  return {
    schemaVersion: USAGE_LOG_SCHEMA_VERSION,
    capturedAt,
    lastSeenAt: capturedAt,
    source: typeof usageData?.source === "string" ? usageData.source : "",
    weeklyFiveHourWindows: normalizeWeeklyWindowCapacity(weeklyFiveHourWindows),
    sessionUsedPercent: session.usedPercent,
    sessionRemainingPercent: session.remainingPercent,
    sessionResetsAt: session.resetsAt,
    weeklyUsedPercent: weekly.usedPercent,
    weeklyRemainingPercent: weekly.remainingPercent,
    weeklyResetsAt: weekly.resetsAt,
    opusWeeklyUsedPercent: weeklyOpus.usedPercent,
    opusWeeklyRemainingPercent: weeklyOpus.remainingPercent,
    opusWeeklyResetsAt: weeklyOpus.resetsAt,
  };
}

function normalizeLogWindow(windowData) {
  if (!windowData) {
    return {
      usedPercent: null,
      remainingPercent: null,
      resetsAt: null,
    };
  }

  const usedPercent = clampPercentage(windowData.percentage || 0);
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: normalizeLogReset(windowData.resetsAt),
  };
}

function normalizeLogReset(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? toLogTimestamp(roundToNearestMinute(timestamp)) : null;
}

function usageLogFingerprint(entry) {
  return JSON.stringify({
    sessionUsedPercent: entry?.sessionUsedPercent ?? null,
    sessionRemainingPercent: entry?.sessionRemainingPercent ?? null,
    sessionResetsAt: canonicalResetFingerprint(entry?.sessionResetsAt),
    weeklyUsedPercent: entry?.weeklyUsedPercent ?? null,
    weeklyRemainingPercent: entry?.weeklyRemainingPercent ?? null,
    weeklyResetsAt: canonicalResetFingerprint(entry?.weeklyResetsAt),
    opusWeeklyUsedPercent: entry?.opusWeeklyUsedPercent ?? null,
    opusWeeklyRemainingPercent: entry?.opusWeeklyRemainingPercent ?? null,
    opusWeeklyResetsAt: canonicalResetFingerprint(entry?.opusWeeklyResetsAt),
  });
}

function compactUsageLog(log) {
  const compacted = [];
  let changed = false;

  for (const rawEntry of log) {
    const entry = normalizeStoredUsageLogEntry(rawEntry);
    const lastEntry = compacted.at(-1);

    if (entry !== rawEntry) changed = true;

    if (lastEntry && usageLogFingerprint(lastEntry) === usageLogFingerprint(entry)) {
      compacted[compacted.length - 1] = mergeDuplicateUsageLogEntries(lastEntry, entry);
      changed = true;
    } else {
      compacted.push(entry);
    }
  }

  return changed ? compacted : log;
}

function normalizeStoredUsageLogEntry(entry) {
  if (!entry) return {};
  const normalized = {
    sessionResetsAt: normalizeLogReset(entry.sessionResetsAt),
    weeklyResetsAt: normalizeLogReset(entry.weeklyResetsAt),
    opusWeeklyResetsAt: normalizeLogReset(entry.opusWeeklyResetsAt),
  };

  if (
    normalized.sessionResetsAt === (entry.sessionResetsAt || null) &&
    normalized.weeklyResetsAt === (entry.weeklyResetsAt || null) &&
    normalized.opusWeeklyResetsAt === (entry.opusWeeklyResetsAt || null)
  ) {
    return entry;
  }

  return {
    ...entry,
    ...normalized,
  };
}

function mergeDuplicateUsageLogEntries(previous, next) {
  return {
    ...previous,
    sessionResetsAt: normalizeLogReset(previous.sessionResetsAt),
    weeklyResetsAt: normalizeLogReset(previous.weeklyResetsAt),
    opusWeeklyResetsAt: normalizeLogReset(previous.opusWeeklyResetsAt),
    lastSeenAt: latestLogTimestamp(previous.lastSeenAt || previous.capturedAt, next.lastSeenAt || next.capturedAt),
  };
}

function trimUsageLog(log) {
  return log.length > USAGE_LOG_LIMIT ? log.slice(-USAGE_LOG_LIMIT) : log;
}

function canonicalResetFingerprint(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? toLogTimestamp(roundToNearestMinute(timestamp)) : null;
}

function roundToNearestMinute(timestamp) {
  return Math.round(timestamp / 60000) * 60000;
}

function latestLogTimestamp(left, right) {
  const leftTimestamp = parseLogTimestamp(left);
  const rightTimestamp = parseLogTimestamp(right);

  if (!Number.isFinite(leftTimestamp)) return toLogTimestamp(rightTimestamp);
  if (!Number.isFinite(rightTimestamp)) return toLogTimestamp(leftTimestamp);
  return toLogTimestamp(Math.max(leftTimestamp, rightTimestamp));
}

function parseLogTimestamp(value) {
  if (typeof value === "number") return value;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function toLogTimestamp(value) {
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
}

function normalizeWeeklyWindowCapacity(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS;
  }
  const numeric = Number(value);
  const rounded = Number.isFinite(numeric) ? Math.round(numeric) : DEFAULT_WEEKLY_FIVE_HOUR_WINDOWS;
  return Math.max(MIN_WEEKLY_FIVE_HOUR_WINDOWS, Math.min(MAX_WEEKLY_FIVE_HOUR_WINDOWS, rounded));
}

function messageLimitToPercentage(type) {
  if (type === "exceeded_limit") return 100;
  if (type === "approaching_limit") return 75;
  return 0;
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function updateBadge(usageData) {
  // Only fall back to the error badge when there is no usable data to show; a
  // transient refresh failure keeps the last known-good badge (see refreshUsage).
  if (!usageData.session) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#D92D20" });
    return;
  }

  // Badge shows quota remaining (a number, no "%", so "100" never gets clipped).
  const remaining = Math.round(clampPercentage(100 - (usageData.session.percentage || 0)));
  chrome.action.setBadgeText({ text: String(remaining) });

  if (remaining >= 100) {
    // Full quota — the limit has just reset. Use a distinct, standout color.
    chrome.action.setBadgeBackgroundColor({ color: "#2563EB" });
  } else if (remaining <= 10) {
    chrome.action.setBadgeBackgroundColor({ color: "#D92D20" });
  } else if (remaining <= 30) {
    chrome.action.setBadgeBackgroundColor({ color: "#B7791F" });
  } else if (remaining <= 50) {
    chrome.action.setBadgeBackgroundColor({ color: "#879532" });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: "#287C5A" });
  }
}

function message(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}
