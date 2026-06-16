const REFRESH_ALARM = "quotalis-refresh";
const REFRESH_PERIOD_MINUTES = 1;
const CLAUDE_ORIGIN = "https://claude.ai";

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
  const { usageData: previous } = await chrome.storage.local.get("usageData");

  let usageData;
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
    usageData.lastUpdated = Date.now();
  }

  await chrome.storage.local.set({ usageData });
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
