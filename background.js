const REFRESH_ALARM = "quotalis-refresh";
const BADGE_ALARM = "quotalis-badge";
const REFRESH_PERIOD_MINUTES = 1;
const BADGE_PERIOD_MINUTES = 0.5;
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
    return;
  }

  if (alarm.name === BADGE_ALARM) {
    chrome.storage.local.get("usageData", ({ usageData }) => {
      if (usageData) updateBadge(usageData);
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "refresh") {
    refreshUsage().then(sendResponse);
    return true;
  }

  if (message?.action === "getData") {
    chrome.storage.local.get("usageData", ({ usageData }) => {
      sendResponse(usageData || null);
    });
    return true;
  }

  return false;
});

function scheduleAlarms() {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: BADGE_PERIOD_MINUTES });
}

async function refreshUsage() {
  const usageData = await readClaudeUsage();
  usageData.lastUpdated = Date.now();
  await chrome.storage.local.set({ usageData });
  updateBadge(usageData);
  return usageData;
}

async function readClaudeUsage() {
  const cookieHeader = await getClaudeCookieHeader();

  if (!cookieHeader) {
    return {
      error: "Not signed in",
      hint: "Open Claude.ai, sign in, then refresh Quotalis.",
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
    error: "Usage unavailable",
    hint: "Claude did not return usage data. Open Claude settings, then refresh.",
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
    plan: detectPlan(payload) || "Pro",
    session,
    weekly,
    weeklyOpus,
    source,
  };
}

function normalizeBootstrapResponse(payload) {
  const usage = {
    plan: detectPlan(payload) || "Pro",
    session: { percentage: 0, resetsAt: null },
    weekly: { percentage: 0, resetsAt: null },
    weeklyOpus: null,
    source: "bootstrap",
  };

  const organization = payload.account?.memberships?.find((membership) => membership.organization)
    ?.organization;

  if (organization) {
    usage.plan = detectOrganizationPlan(organization) || usage.plan;
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

function detectPlan(value) {
  const text = JSON.stringify(value || {}).toLowerCase();
  if (text.includes("max_20x")) return "Max 20x";
  if (text.includes("max_5x")) return "Max 5x";
  if (text.includes("enterprise")) return "Enterprise";
  if (text.includes("team")) return "Team";
  if (text.includes("claude_pro") || text.includes('"pro"')) return "Pro";
  if (text.includes("claude_free") || text.includes('"free"')) return "Free";
  if (text.includes('"max"')) return "Max";
  return null;
}

function detectOrganizationPlan(organization) {
  const billing = (organization.billing_type || organization.subscription_type || "").toLowerCase();
  const capabilities = JSON.stringify(organization.capabilities || {}).toLowerCase();
  const text = `${billing} ${capabilities}`;

  if (text.includes("max_20x")) return "Max 20x";
  if (text.includes("max_5x")) return "Max 5x";
  if (text.includes("max")) return "Max";
  if (text.includes("enterprise")) return "Enterprise";
  if (text.includes("team")) return "Team";
  if (text.includes("pro")) return "Pro";
  if (text.includes("free")) return "Free";
  return billing || null;
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function updateBadge(usageData) {
  if (usageData.error) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#D92D20" });
    return;
  }

  const remaining = Math.max(0, 100 - (usageData.session?.percentage || 0));
  chrome.action.setBadgeText({ text: `${remaining}%` });

  if (remaining <= 10) {
    chrome.action.setBadgeBackgroundColor({ color: "#D92D20" });
  } else if (remaining <= 30) {
    chrome.action.setBadgeBackgroundColor({ color: "#B7791F" });
  } else {
    chrome.action.setBadgeBackgroundColor({ color: "#287C5A" });
  }
}
