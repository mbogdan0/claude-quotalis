const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredLocales = ["en", "uk", "de", "fr", "es", "vi", "th", "id", "pt_BR", "ja", "zh_CN", "it"];
const requiredMessageKeys = [
  "extensionName",
  "extensionDescription",
  "popupEyebrow",
  "popupHeading",
  "refreshUsage",
  "summaryUpdatedLabel",
  "weeklyWindowSettingLabel",
  "weeklyWindowSettingInputAria",
  "weeklyWindowSettingHelp",
  "forecastSettingsLabel",
  "forecastTitle",
  "forecastWorkWeekends",
  "forecastDoneToday",
  "never",
  "readingUsage",
  "footerGithubAria",
  "github",
  "openClaude",
  "routines",
  "weekWindowLabel",
  "dayToday",
  "dayWeekend",
  "dayWindows",
  "sessionUsage",
  "weeklyUsage",
  "opusWeeklyUsage",
  "usagePercent",
  "remainingPercent",
  "noResetTime",
  "now",
  "secondsAgo",
  "minuteAgo",
  "minutesAgo",
  "hourAgo",
  "hoursAgo",
  "resetting",
  "resetInDaysHours",
  "resetInHoursMinutes",
  "resetInMinutes",
  "notSignedIn",
  "signInHint",
  "usageUnavailable",
  "usageUnavailableHint",
  "refreshFailed",
];
const publishableFiles = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "README.md",
  ...requiredLocales.map((locale) => `_locales/${locale}/messages.json`),
];
const expectedZipEntries = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "README.md",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  ...requiredLocales.map((locale) => `_locales/${locale}/messages.json`),
];
const forbiddenPatterns = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bnew\s+Function\b/,
  /\bimportScripts\s*\(/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /\bXMLHttpRequest\b/,
  /\bchrome\.tabs\b/,
  /\bchrome\.webRequest\b/,
  /\bdeclarativeNetRequest\b/,
  /\bnativeMessaging\b/,
  /\bchrome\.scripting\b/,
  /\bexecuteScript\b/,
  /\batob\s*\(/,
  /\bbtoa\s*\(/,
];

const errors = [];
const enMessages = JSON.parse(read("_locales/en/messages.json"));

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  checkManifest();
  checkPackageVersion();
  checkLocales();
  checkJavaScriptSyntax("background.js");
  checkJavaScriptSyntax("popup.js");
  checkJavaScriptSyntax("scripts/build.js");
  checkJavaScriptSyntax("scripts/release.js");
  checkTextPatterns();
  checkUrls();
  checkZipContents();
  checkUsageNormalization();
  await checkUsageLogStorage();
  checkPopupSummaryStatus();
  checkPopupLogExport();
  checkPopupCss();
  checkBadgeColors();
  checkPopupBarTones();
  checkPopupWeekWindow();

  if (errors.length) {
    console.error("Verification failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("Verification passed.");
}

function checkManifest() {
  const manifest = JSON.parse(read("manifest.json"));
  expectEqual(manifest.manifest_version, 3, "Manifest version must be 3.");
  expectEqual(manifest.name, "__MSG_extensionName__", "Manifest name must use Chrome i18n.");
  expectEqual(manifest.description, "__MSG_extensionDescription__", "Manifest description must use Chrome i18n.");
  expectEqual(manifest.default_locale, "en", "Manifest default locale must be en.");
  expectEqual(manifest.action?.default_title, "__MSG_extensionName__", "Manifest action title must use Chrome i18n.");
  expectArrayEqual(manifest.permissions, ["cookies", "alarms", "storage"], "Unexpected permissions.");
  expectArrayEqual(manifest.host_permissions, ["https://claude.ai/*"], "Unexpected host permissions.");
  if (manifest.content_scripts) errors.push("Content scripts are not expected.");
  if (manifest.externally_connectable) errors.push("External connections are not expected.");
}

function checkPackageVersion() {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));
  expectEqual(packageJson.version, manifest.version, "Package version must match manifest version.");
}

function checkLocales() {
  for (const locale of requiredLocales) {
    const file = `_locales/${locale}/messages.json`;
    if (!fs.existsSync(path.join(root, file))) {
      errors.push(`Missing locale file: ${file}.`);
      continue;
    }

    let messages;
    try {
      messages = JSON.parse(read(file));
    } catch (error) {
      errors.push(`${file} has invalid JSON: ${error.message}`);
      continue;
    }

    for (const key of requiredMessageKeys) {
      const entry = messages[key];
      if (!entry || typeof entry.message !== "string" || !entry.message.trim()) {
        errors.push(`${file} is missing message key ${key}.`);
      }
    }

    const extraKeys = Object.keys(messages).filter((key) => !requiredMessageKeys.includes(key));
    if (extraKeys.length) {
      errors.push(`${file} contains unexpected message keys: ${extraKeys.join(", ")}.`);
    }

    if (locale !== "en") {
      const untranslatedWeeklyWindowKeys = [
        "weeklyWindowSettingLabel",
        "weeklyWindowSettingInputAria",
        "weeklyWindowSettingHelp",
        "forecastSettingsLabel",
        "forecastTitle",
        "forecastWorkWeekends",
        "forecastDoneToday",
      ].filter((key) => messages[key]?.message === enMessages[key]?.message);
      if (untranslatedWeeklyWindowKeys.length) {
        errors.push(`${file} contains untranslated weekly window keys: ${untranslatedWeeklyWindowKeys.join(", ")}.`);
      }
    }
  }
}

function checkJavaScriptSyntax(file) {
  try {
    new vm.Script(read(file), { filename: file });
  } catch (error) {
    errors.push(`${file} has invalid JavaScript syntax: ${error.message}`);
  }
}

function checkTextPatterns() {
  for (const file of publishableFiles) {
    const text = read(file);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(text)) {
        errors.push(`${file} contains forbidden pattern ${pattern}.`);
      }
    }
  }
}

function checkUrls() {
  const urlPattern = /https?:\/\/[^"' <>)`]+/g;
  for (const file of publishableFiles) {
    const urls = read(file).match(urlPattern) || [];
    for (const url of urls) {
      const allowed =
        url === "https://claude.ai" ||
        url === "https://claude.ai/*" ||
        url === "https://claude.ai/code/routines" ||
        url === "https://claude.ai/api/..." ||
        url.startsWith("https://claude.ai/api/") ||
        url === "https://github.com/mbogdan0/claude-quotalis";
      if (!allowed) errors.push(`${file} contains unexpected URL: ${url}`);
    }
  }
}

function checkZipContents() {
  const manifest = JSON.parse(read("manifest.json"));
  const zipPath = path.join(root, "dist", `quotalis-for-claude-${manifest.version}.zip`);
  if (!fs.existsSync(zipPath)) return;

  const output = childProcess.execFileSync("unzip", ["-Z1", zipPath], {
    cwd: root,
    encoding: "utf8",
  });
  const entries = output.trim().split(/\n/).filter((entry) => entry && !entry.endsWith("/")).sort();
  expectArrayEqual(entries, [...expectedZipEntries].sort(), "ZIP contains unexpected files.");
}

function checkUsageNormalization() {
  const background = loadBackgroundExports();
  const usagePayload = {
    five_hour: {
      utilization: 0,
      resets_at: null,
    },
    seven_day: {
      utilization: 0,
      resets_at: "2026-06-15T20:00:00.413366+00:00",
    },
    seven_day_oauth_apps: null,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_cowork: null,
    seven_day_omelette: null,
    tangelo: null,
    iguana_necktie: null,
    omelette_promotional: null,
    cinder_cove: null,
    extra_usage: null,
  };

  const normalized = background.normalizeUsageResponse(
    { ...usagePayload, plan: "claude_pro", subscription_type: "claude_free" },
    "usage"
  );
  expectEqual(normalized.session.percentage, 0, "Usage payload must still normalize session utilization.");
  expectEqual(normalized.weekly.percentage, 0, "Usage payload must still normalize weekly utilization.");
  expectEqual(normalized.source, "usage", "Usage payload must preserve its source.");
  expectEqual(normalized.signedIn, true, "Successful usage payloads must mark the user as signed in.");
  expectEqual(
    Object.prototype.hasOwnProperty.call(normalized, "plan"),
    false,
    "Usage normalization must not keep plan labels."
  );
  expectEqual(
    Object.prototype.hasOwnProperty.call(normalized, "planDetected"),
    false,
    "Usage normalization must not keep plan detection state."
  );
}

async function checkUsageLogStorage() {
  const background = loadBackgroundExports();
  const baseTime = Date.UTC(2026, 5, 24, 10, 0, 0);
  const usage = {
    source: "usage",
    session: { percentage: 40, resetsAt: "2026-06-24T15:00:00.000Z" },
    weekly: { percentage: 20, resetsAt: "2026-06-29T15:00:00.000Z" },
    weeklyOpus: null,
  };

  const firstLog = background.updateUsageLog([], usage, 5, baseTime);
  expectEqual(firstLog.length, 1, "First successful usage state must append one log entry.");
  expectEqual(firstLog[0].schemaVersion, 1, "Usage log entries must carry the schema version.");
  expectEqual(firstLog[0].weeklyFiveHourWindows, 5, "Usage log entries must store the current weekly 5h setting.");
  expectEqual(firstLog[0].sessionRemainingPercent, 60, "Usage log entries must store session remaining percent.");
  expectEqual(firstLog[0].weeklyRemainingPercent, 80, "Usage log entries must store weekly remaining percent.");
  expectEqual(firstLog[0].opusWeeklyUsedPercent, null, "Missing Opus weekly usage must be stored as null.");

  const sameSoon = background.updateUsageLog(firstLog, usage, 5, baseTime + 10 * 60 * 1000);
  expectEqual(sameSoon.length, 1, "Identical quota states must not append duplicate log entries.");
  expectEqual(
    sameSoon[0].lastSeenAt,
    firstLog[0].lastSeenAt,
    "Identical quota states must not update lastSeenAt before 30 minutes."
  );

  const sameLater = background.updateUsageLog(firstLog, usage, 5, baseTime + 31 * 60 * 1000);
  expectEqual(sameLater.length, 1, "Identical quota states after 30 minutes must still stay one entry.");
  expectEqual(
    sameLater[0].lastSeenAt,
    "2026-06-24T10:31:00.000Z",
    "Identical quota states after 30 minutes must refresh lastSeenAt."
  );

  const withStaleMetadata = background.updateUsageLog(
    firstLog,
    { ...usage, lastError: "Temporary failure", lastErrorAt: baseTime + 1000 },
    5,
    baseTime + 1000
  );
  expectEqual(
    withStaleMetadata.length,
    1,
    "Refresh failure metadata must not create a distinct usage log fingerprint."
  );

  const changedUserSetting = background.updateUsageLog(firstLog, usage, 12, baseTime + 1000);
  expectEqual(
    changedUserSetting.length,
    1,
    "Changing the user weekly 5h setting must not create a distinct quota log fingerprint."
  );

  const changedSource = background.updateUsageLog(firstLog, { ...usage, source: "settings_usage" }, 5, baseTime + 1000);
  expectEqual(
    changedSource.length,
    1,
    "Changing only the Claude endpoint source must not create a distinct quota log fingerprint."
  );

  const jitteredReset = background.updateUsageLog(
    firstLog,
    {
      ...usage,
      session: { percentage: 40, resetsAt: "2026-06-24T15:00:00.419049+00:00" },
      weekly: { percentage: 20, resetsAt: "2026-06-29T15:00:00.419071+00:00" },
    },
    5,
    baseTime + 1000
  );
  expectEqual(
    jitteredReset.length,
    1,
    "Sub-second reset timestamp jitter around the same minute must not create duplicate log entries."
  );

  const duplicateJitterLog = [
    {
      ...firstLog[0],
      capturedAt: "2026-06-24T12:33:04.379Z",
      lastSeenAt: "2026-06-24T12:33:04.379Z",
      sessionResetsAt: "2026-06-24T13:39:59.648202+00:00",
      weeklyResetsAt: "2026-06-29T19:59:59.648227+00:00",
    },
    {
      ...firstLog[0],
      capturedAt: "2026-06-24T12:38:40.186Z",
      lastSeenAt: "2026-06-24T12:38:40.186Z",
      sessionResetsAt: "2026-06-24T13:40:00.419049+00:00",
      weeklyResetsAt: "2026-06-29T20:00:00.419071+00:00",
    },
  ];
  const compactedJitterLog = background.updateUsageLog(
    duplicateJitterLog,
    {
      ...usage,
      session: { percentage: 40, resetsAt: "2026-06-24T13:39:59.902319+00:00" },
      weekly: { percentage: 20, resetsAt: "2026-06-29T19:59:59.902344+00:00" },
    },
    5,
    Date.UTC(2026, 5, 24, 12, 39, 0)
  );
  expectEqual(
    compactedJitterLog.length,
    1,
    "Stored consecutive rows that only differ by reset timestamp jitter must be compacted."
  );
  expectEqual(
    compactedJitterLog[0].lastSeenAt,
    "2026-06-24T12:38:40.186Z",
    "Compacting reset jitter duplicates must preserve the latest seen timestamp."
  );
  expectEqual(
    compactedJitterLog[0].sessionResetsAt,
    "2026-06-24T13:40:00.000Z",
    "Compacting reset jitter duplicates must normalize reset timestamps to the nearest minute."
  );

  const changedQuota = background.updateUsageLog(
    sameSoon,
    { ...usage, session: { ...usage.session, percentage: 41 } },
    5,
    baseTime + 60 * 1000
  );
  expectEqual(changedQuota.length, 2, "Changed quota values must append immediately, even within 30 minutes.");

  const changedReset = background.updateUsageLog(
    changedQuota,
    { ...usage, session: { percentage: 41, resetsAt: "2026-06-24T16:00:00.000Z" } },
    5,
    baseTime + 2 * 60 * 1000
  );
  expectEqual(changedReset.length, 3, "Changed reset timestamps must append immediately.");

  const overLimitLog = Array.from({ length: 3001 }, (_unused, index) => ({
    ...firstLog[0],
    capturedAt: new Date(baseTime + index).toISOString(),
    lastSeenAt: new Date(baseTime + index).toISOString(),
    sessionResetsAt: new Date(baseTime + index * 60000).toISOString(),
    source: `usage-${index}`,
  }));
  const trimmed = background.updateUsageLog(
    overLimitLog,
    { ...usage, source: "latest" },
    5,
    baseTime + 2000
  );
  expectEqual(trimmed.length, 3000, "Usage log storage must keep at most 3000 entries.");
  expectEqual(trimmed[0].source, "usage-2", "Usage log trimming must keep the newest entries.");
  expectEqual(trimmed.at(-1).source, "latest", "Usage log trimming must keep the newest appended entry.");

  const payload = {
    five_hour: { utilization: 33, resets_at: "2026-06-24T15:00:00.000Z" },
    seven_day: { utilization: 20, resets_at: "2026-06-29T15:00:00.000Z" },
    seven_day_opus: null,
  };
  const refreshBackground = loadBackgroundExports({
    cookiesGetAll: [{ name: "session", value: "abc" }],
    cookieGet: { value: "org-1" },
    storageGetResult: { usageLog: [], weeklyFiveHourWindows: 7 },
    fetch: async () => ({
      ok: true,
      json: async () => payload,
    }),
  });
  await refreshBackground.refreshUsage();
  expectEqual(
    refreshBackground.__storageState.usageLog?.length,
    1,
    "A successful background refresh must persist one usage log entry."
  );
  expectEqual(
    refreshBackground.__storageState.usageLog?.[0]?.weeklyFiveHourWindows,
    7,
    "Background refresh logging must use the stored weekly 5h setting."
  );

  const signedOutWithCachedUsage = loadBackgroundExports({
    cookiesGetAll: [],
    storageGetResult: { usageData: usage, usageLog: [] },
  });
  await signedOutWithCachedUsage.refreshUsage();
  expectEqual(
    signedOutWithCachedUsage.__storageState.usageData?.signedIn,
    false,
    "A signed-out refresh must mark stale cached usage as not signed in."
  );
  expectTruthy(
    signedOutWithCachedUsage.__storageState.usageData?.session,
    "A signed-out refresh with cached usage must still keep the stale quota numbers."
  );
}

function checkPopupSummaryStatus() {
  const popup = loadPopupExports();

  popup.exports.renderUsage({
    plan: "Pro",
    planDetected: true,
    session: { percentage: 0, resetsAt: null },
    weekly: { percentage: 0, resetsAt: new Date(Date.now() + 48 * 3600000).toISOString() },
    lastUpdated: Date.now(),
  });
  expectEqual(
    popup.elements.updatedValue.textContent,
    "now",
    "Plan fields must not affect the compact header Updated status."
  );
  expectTruthy(
    read("popup.html").includes('class="header-status"') &&
      read("popup.html").includes('id="updatedValue"'),
    "Updated status must render under the popup heading."
  );
  expectTruthy(
    read("popup.html").includes('id="routinesLink"') &&
      read("popup.html").includes('data-i18n="routines"') &&
      read("popup.html").includes("hidden") &&
      !read("popup.html").includes("optimizeUsage"),
    "The footer routines link must use the Routines label key and start hidden."
  );
  expectEqual(
    popup.elements.routinesLink.hidden,
    false,
    "Routines link must show when usable signed-in usage data is rendered."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("weekly-footer"),
    "Weekly controls must render inside the weekly footer."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("weekly-updated"),
    false,
    "The old footer Updated status must not render inside the weekly footer."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes('id="weeklyWindowInput"'),
    "Weekly footer must render the saved five-hour-window capacity input."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes('type="number"') &&
      popup.elements.content.innerHTML.includes('min="1"') &&
      popup.elements.content.innerHTML.includes('max="500"') &&
      popup.elements.content.innerHTML.includes('step="1"'),
    "Weekly capacity input must be a compact clamped integer number input."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("weeklyWindowSettingInputAria"),
    "Weekly capacity input must expose an accessible label."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("data-weekly-window-tooltip=") &&
      popup.elements.content.innerHTML.includes('tabindex="0"'),
    "Weekly capacity help icon must render a keyboard-focusable tooltip."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("week-window"),
    "Weekly usage must render the 7-day window strip."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("day-cell"),
    "Weekly usage must render the per-day window cells."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("data-forecast-settings-toggle") &&
      popup.elements.content.innerHTML.includes('aria-label="Forecast settings"') &&
      popup.elements.content.innerHTML.includes('aria-expanded="false"'),
    "Weekly controls must render the collapsed Forecast settings button beside the day strip."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("weekly-forecast-panel"),
    false,
    "Forecast settings must stay collapsed by default."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("data-week-window-toggle"),
    false,
    "The old hidden today-square toggle must not render."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("Pace"),
    false,
    "The legacy Pace popover label must not render."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("Peak"),
    false,
    "The legacy Peak popover label must not render."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes('class="reset-time"'),
    "Reset labels with timestamps must use the reset tooltip class."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("data-reset-tooltip="),
    "Reset labels with timestamps must include localized tooltip text."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes('tabindex="0"'),
    "Reset tooltip labels must be keyboard-focusable."
  );
  expectTruthy(
    popup.elements.content.innerHTML.includes("<span>noResetTime</span>"),
    "Missing reset times must render as plain text without tooltip attributes."
  );
  expectEqual(
    popup.exports.formatResetDateTime("not-a-date"),
    "noResetTime",
    "Invalid reset tooltip timestamps must use the no-reset fallback."
  );
  expectTruthy(
    popup.exports.formatResetDateTime("2026-06-18T13:30:00.000Z").includes("2026"),
    "Reset tooltip timestamps must format as a friendly localized date/time."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("weekly-status"),
    false,
    "Weekly status card must not render."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("You are on pace for the reset"),
    false,
    "Weekly status headline must not render."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("GMT+4"),
    false,
    "User-visible popup HTML must not mention the policy timezone."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes("planValue"),
    false,
    "Plan fields must not render in the popup content."
  );

  popup.exports.renderUsage({
    error: "Usage unavailable",
    hint: "Try again later.",
    lastUpdated: Date.now(),
    signedIn: false,
  });
  expectTruthy(
    popup.elements.content.innerHTML.includes("Usage unavailable"),
    "Error states must still render the error message."
  );
  expectEqual(
    popup.elements.routinesLink.hidden,
    true,
    "Routines link must hide when the user is not signed in to Claude."
  );
}

function checkPopupLogExport() {
  const popup = loadPopupExports();
  const reset = new Date(Date.now() + 48 * 3600000).toISOString();

  popup.exports.renderUsage({
    session: { percentage: 10, resetsAt: reset },
    weekly: { percentage: 20, resetsAt: reset },
    lastUpdated: Date.now(),
  });
  expectTruthy(
    popup.elements.content.innerHTML.includes("data-usage-log-download") &&
      popup.elements.content.innerHTML.includes('data-log-download-tooltip="Download logs"') &&
      popup.elements.content.innerHTML.includes('aria-label="Download logs"'),
    "Weekly controls must render an accessible Download logs tooltip button beside the help icon."
  );
  expectEqual(
    popup.elements.content.innerHTML.includes('title="Download logs"'),
    false,
    "The Download logs control must use a custom tooltip instead of a native title attribute."
  );

  const csv = popup.exports.usageLogToCsv([
    {
      capturedAt: "2026-06-24T10:00:00.000Z",
      lastSeenAt: "2026-06-24T10:30:00.000Z",
      source: "usage,\"quoted\"",
      weeklyFiveHourWindows: 9,
      sessionUsedPercent: 10,
      sessionRemainingPercent: 90,
      sessionResetsAt: "line\nbreak",
      weeklyUsedPercent: 20,
      weeklyRemainingPercent: 80,
      weeklyResetsAt: "2026-06-29T10:00:00.000Z",
      opusWeeklyUsedPercent: null,
      opusWeeklyRemainingPercent: null,
      opusWeeklyResetsAt: null,
    },
  ]);
  expectTruthy(
    csv.startsWith("captured_at,last_seen_at,source,session_used_percent,"),
    "CSV export must start with the expected header columns."
  );
  expectEqual(
    csv.includes("weekly_five_hour_windows"),
    false,
    "CSV export must not include the user weekly 5h setting column."
  );
  expectTruthy(
    csv.includes('"usage,""quoted"""') && csv.includes('"line\nbreak"'),
    "CSV export must escape commas, quotes, and newlines."
  );
  expectEqual(
    popup.exports.usageLogFilename(new Date(2026, 5, 24, 9, 8, 7)),
    "quotalis-usage-log-2026-06-24-09-08-07.csv",
    "CSV export filename must use the expected timestamp format."
  );
}

function checkPopupCss() {
  const css = read("popup.css");
  expectTruthy(
    css.includes("bottom: calc(100% + 6px);"),
    "Weekly and reset popovers must be positioned above their anchors."
  );
  expectTruthy(
    css.includes(".reset-time[data-reset-tooltip]:hover::after"),
    "Reset tooltip CSS must expose the tooltip on hover."
  );
  expectTruthy(
    css.includes(".reset-time[data-reset-tooltip]:focus-visible::after"),
    "Reset tooltip CSS must expose the tooltip on keyboard focus."
  );
  expectTruthy(
    css.includes(".weekly-window-help[data-weekly-window-tooltip]:focus-visible::after"),
    "Weekly capacity tooltip CSS must expose the tooltip on keyboard focus."
  );
  expectTruthy(
      css.includes(".weekly-window-help[data-weekly-window-tooltip]::after") &&
      css.includes("left: 50%;") &&
      css.includes("width: 220px;") &&
      css.includes("transform: translate(-45%, 2px);") &&
      css.includes("transform: translate(-45%, 0);") &&
      css.includes("white-space: normal;"),
    "Weekly capacity tooltip must be centered with a left bias and wrap inside the popup."
  );
  expectTruthy(
    css.includes(".day-cell[data-day-tooltip]::after") &&
      css.includes("right: 6px;"),
    "Day-square tooltips must be shifted left from their anchors."
  );
  expectTruthy(
    css.includes(".forecast-settings-toggle") &&
      css.includes(".forecast-settings-toggle[data-forecast-settings-tooltip]:focus-visible::after"),
    "Forecast settings button must have compact styling and a keyboard-focusable tooltip."
  );
  expectTruthy(
    css.includes(".weekly-forecast-panel") &&
      css.includes(".forecast-check input:checked") &&
      css.includes(".day-cell--today-done"),
    "Forecast settings panel, checkbox, and done-today square styles must exist."
  );
}

function checkBadgeColors() {
  const badgeCalls = [];
  const background = loadBackgroundExports({
    setBadgeText: (value) => badgeCalls.push({ type: "text", ...value }),
    setBadgeBackgroundColor: (value) => badgeCalls.push({ type: "color", ...value }),
  });

  const cases = [
    { remaining: 100, color: "#2563EB" },
    { remaining: 75, color: "#287C5A" },
    { remaining: 50, color: "#879532" },
    { remaining: 30, color: "#B7791F" },
    { remaining: 10, color: "#D92D20" },
  ];

  for (const item of cases) {
    badgeCalls.length = 0;
    background.updateBadge({ session: { percentage: 100 - item.remaining } });
    const colorCall = badgeCalls.find((call) => call.type === "color");
    const textCall = badgeCalls.find((call) => call.type === "text");
    expectEqual(textCall?.text, String(item.remaining), `Badge must show ${item.remaining}% remaining.`);
    expectEqual(
      colorCall?.color,
      item.color,
      `Badge color for ${item.remaining}% remaining must match the intended threshold.`
    );
  }
}

function checkPopupBarTones() {
  const popup = loadPopupExports();
  const now = Date.now();
  const hoursFromNow = (hours) => new Date(now + hours * 3600000).toISOString();

  expectEqual(popup.exports.barTone(45, null, "session"), "attention", "Session bars need the new caution tone.");
  expectEqual(popup.exports.barTone(25, null, "session"), "warning", "Session bars must keep the amber warning tone.");
  expectEqual(popup.exports.barTone(8, null, "session"), "danger", "Session bars must keep the critical tone.");
  expectEqual(
    popup.exports.barTone(20, hoursFromNow(24), "weeklyCapacity"),
    "",
    "Main weekly bars with enough five-hour-window capacity must stay neutral."
  );
  expectEqual(
    popup.exports.barTone(20, hoursFromNow(72), "weeklyCapacity"),
    "warning",
    "Main weekly bars without enough five-hour-window capacity must fall back to percentage warning."
  );
  expectEqual(
    popup.exports.barTone(8, hoursFromNow(72), "weeklyCapacity"),
    "danger",
    "Main weekly bars without enough capacity must keep percentage danger."
  );
  expectEqual(
    popup.exports.barTone(20, null, "weeklyCapacity"),
    "warning",
    "Main weekly bars with missing reset time must fall back to percentage thresholds."
  );
  expectEqual(
    popup.exports.barTone(20, hoursFromNow(24), "weeklyLegacy"),
    "warning",
    "Opus weekly bars must keep percentage-based thresholds."
  );
}

function checkPopupWeekWindow() {
  const popup = loadPopupExports();

  // Wednesday Jun 24 2026, 10:00 local.
  const wednesday = new Date(2026, 5, 24, 10, 0, 0);
  // Reset on Monday Jun 29 2026 -> cells map to Tue23..Mon29.
  const monReset = new Date(2026, 5, 29, 12, 0, 0).toISOString();
  const week = popup.exports.weekWindowDays({ percentage: 0, resetsAt: monReset }, wednesday);

  expectEqual(week.length, 7, "The 7-day window must always render seven cells.");
  expectEqual(week[6].state, "future", "The last cell is the reset day, in the future here.");
  expectEqual(week[1].state, "today", "Today must be detected inside the window.");
  expectEqual(
    week[1].tooltip,
    "Wed · ~2.3 × 5h windows",
    "Default forecast must include today in the split."
  );
  expectEqual(week[1].windows, 9 / 4, "Default forecast must give weekday today an even share.");
  expectEqual(week[0].state, "past", "Days before today are in the past.");
  expectEqual(week[0].tooltip, "Tue", "Past days show the three-letter weekday tooltip.");
  expectEqual(week[4].weekend, true, "Saturday must be flagged as a weekend cell.");
  expectEqual(week[4].excluded, true, "Future weekends must be excluded by default.");
  expectEqual(week[4].windows, 0, "Future weekend days must default to zero windows.");
  expectEqual(week[4].tooltip, "Sat · 0 windows", "Future weekend tooltips must show zero without the Weekend label.");
  expectEqual(week[2].tooltip, "Thu · ~2.3 × 5h windows", "Future weekday tooltips must include the weekday label.");
  expectEqual(
    week.some((cell) => /dayToday|Today|dayWeekend|Weekend/.test(cell.tooltip)),
    false,
    "Day-square tooltips must not spell out Today or Weekend."
  );
  // remainingWindows = 9; eligible weekdays = Wed + Thu + Fri + Mon = 4 -> 2.25/day.
  expectEqual(week[2].windows, 9 / 4, "Future weekdays must split remaining windows with today included.");

  const doneTodayWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    wednesday,
    { doneToday: true }
  );
  expectEqual(
    doneTodayWeek[1].windows,
    0,
    "Done-today mode must give today zero forecast windows."
  );
  expectEqual(
    doneTodayWeek[1].tooltip,
    "Wed · 0 windows",
    "Done-today mode must show the weekday and zero-window text on today."
  );
  expectEqual(
    doneTodayWeek[2].windows,
    9 / 3,
    "Done-today mode must spread quota over later eligible weekdays."
  );

  const weekendForecastWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    wednesday,
    { includeWeekends: true }
  );
  expectEqual(
    weekendForecastWeek[4].windows,
    9 / 6,
    "Work-weekends mode must include Saturday in the divisor."
  );
  expectEqual(
    weekendForecastWeek[4].excluded,
    false,
    "Work-weekends mode must remove the excluded weekend state."
  );
  expectEqual(
    weekendForecastWeek[4].tooltip,
    "Sat · ~1.5 × 5h windows",
    "Work-weekends mode must show a window estimate on Saturday."
  );

  const combinedForecastWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    wednesday,
    { doneToday: true, includeWeekends: true }
  );
  expectEqual(combinedForecastWeek[1].windows, 0, "Combined mode must still mark today done.");
  expectEqual(
    combinedForecastWeek[4].windows,
    9 / 5,
    "Combined mode must split later quota across weekdays and weekends."
  );

  const customCapacityWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    wednesday,
    { weeklyWindows: 12 }
  );
  expectEqual(
    customCapacityWeek[1].windows,
    12 / 4,
    "Custom weekly capacity must drive default weekday math."
  );
  expectEqual(
    customCapacityWeek[1].tooltip,
    "Wed · ~3.0 × 5h windows",
    "Custom weekly capacity must update rendered window-count tooltip text."
  );

  const saturday = new Date(2026, 5, 27, 10, 0, 0);
  const weekendTodayWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    saturday
  );
  expectEqual(weekendTodayWeek[4].state, "today", "Saturday must be detected as today in the weekend case.");
  expectEqual(weekendTodayWeek[4].weekend, true, "Weekend today must still be marked as a weekend.");
  expectEqual(weekendTodayWeek[4].windows, 0, "Weekend today must default to zero windows.");
  expectEqual(
    weekendTodayWeek[4].tooltip,
    "Sat · 0 windows",
    "Weekend today tooltip must show the weekday and zero-window text."
  );
  expectEqual(
    weekendTodayWeek[6].windows,
    9,
    "Default forecast excludes weekend days from the divisor even when today is a weekend."
  );

  const weekendIncludedTodayWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: monReset },
    saturday,
    { includeWeekends: true }
  );
  expectEqual(
    weekendIncludedTodayWeek[4].windows,
    9 / 3,
    "Work-weekends mode must include weekend today in the divisor."
  );
  expectEqual(
    weekendIncludedTodayWeek[5].windows,
    9 / 3,
    "Work-weekends mode must include Sunday in the divisor."
  );

  const tuesdayMidnightReset = new Date(2026, 5, 30, 0, 0, 0).toISOString();
  const normalizedMidnightWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: tuesdayMidnightReset },
    wednesday
  );
  expectEqual(
    normalizedMidnightWeek[6].tooltip,
    "Mon · ~2.3 × 5h windows",
    "A Tuesday 00:00 weekly reset must normalize to Monday end for square anchoring."
  );
  expectEqual(
    normalizedMidnightWeek[2].windows,
    9 / 4,
    "A Tuesday 00:00 weekly reset must exclude Tuesday while including today in default divisor math."
  );

  const tuesdayFirstHourReset = new Date(2026, 5, 30, 0, 59, 59).toISOString();
  const normalizedFirstHourWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: tuesdayFirstHourReset },
    wednesday
  );
  expectEqual(
    normalizedFirstHourWeek[6].tooltip,
    "Mon · ~2.3 × 5h windows",
    "A Tuesday reset during the first local hour must normalize to Monday end."
  );

  const tuesdayOneAmReset = new Date(2026, 5, 30, 1, 0, 0).toISOString();
  const unnormalizedOneAmWeek = popup.exports.weekWindowDays(
    { percentage: 0, resetsAt: tuesdayOneAmReset },
    wednesday
  );
  expectEqual(
    unnormalizedOneAmWeek[6].tooltip,
    "Tue · ~1.8 × 5h windows",
    "A Tuesday 01:00 weekly reset must stay on Tuesday."
  );
  expectEqual(
    unnormalizedOneAmWeek[0].windows,
    9 / 5,
    "A Tuesday 01:00 weekly reset must include today and Tuesday in default divisor math."
  );

  // The result must not depend on the time of day (no 18:00 cutoff anymore).
  const evening = new Date(2026, 5, 24, 19, 0, 0);
  const eveningWeek = popup.exports.weekWindowDays({ percentage: 0, resetsAt: monReset }, evening);
  expectEqual(eveningWeek[1].state, "today", "Today is still detected in the evening.");
  expectEqual(eveningWeek[1].windows, 9 / 4, "Today keeps its per-day window count in the evening.");
  expectEqual(eveningWeek[2].windows, week[2].windows, "Per-day allowance must be time-of-day independent.");

  // A fresh ~7-day window puts the reset day up to 7 days out; today must still
  // be shown (clamped to the first cell) rather than falling off the strip.
  const farReset = new Date(2026, 6, 1, 12, 0, 0).toISOString(); // Wed Jul 1 2026, ~7 days out
  const farWeek = popup.exports.weekWindowDays({ percentage: 0, resetsAt: farReset }, wednesday);
  expectEqual(
    farWeek.filter((cell) => cell.state === "today").length,
    1,
    "Today must always be visible, even when the reset is a full ~7 days out."
  );
  expectEqual(farWeek[0].state, "today", "When the reset is far out, today anchors the first cell.");
  // The divisor must use the true horizon (today Wed, Thu, Fri, Mon, Tue + the
  // off-strip reset day Wed = 6 weekdays), not just the visible future cells.
  expectEqual(
    farWeek[1].windows,
    9 / 6,
    "Per-day allowance must divide by every weekday until the actual reset, including the clamped-off reset day."
  );

  const noReset = popup.exports.weekWindowDays({ percentage: 50, resetsAt: null });
  expectEqual(noReset.length, 7, "Missing reset still renders a seven-cell strip.");
  expectEqual(
    noReset.every((cell) => typeof cell.tooltip === "string" && cell.tooltip.length === 3),
    true,
    "Without a reset time, cells still carry three-letter weekday tooltips."
  );

  const htmlReset = new Date(Date.now() + 72 * 3600000).toISOString();
  const defaultHtml = popup.exports.weekWindow({ percentage: 0, resetsAt: htmlReset });
  expectEqual(
    defaultHtml.includes('data-week-window-toggle="true"') || defaultHtml.includes("aria-pressed="),
    false,
    "Rendered week window must not expose the old hidden today toggle."
  );
  const doneHtml = popup.exports.weekWindow(
    { percentage: 0, resetsAt: htmlReset },
    { doneToday: true }
  );
  expectTruthy(
    doneHtml.includes("day-cell--today-done"),
    "Rendered done-today week window must use the done-today style."
  );
  expectEqual(
    defaultHtml.includes("day-cell--today-active"),
    false,
    "Rendered week window must not use the legacy active today style."
  );

  expectEqual(
    popup.exports.normalizeWeeklyWindowCapacity(undefined),
    9,
    "Missing weekly capacity must default to nine five-hour windows."
  );
  expectEqual(
    popup.exports.normalizeWeeklyWindowCapacity(0),
    1,
    "Weekly capacity must clamp values below one."
  );
  expectEqual(
    popup.exports.normalizeWeeklyWindowCapacity(501),
    500,
    "Weekly capacity must clamp values above five hundred."
  );
  expectEqual(
    popup.exports.normalizeWeeklyWindowCapacity(9.4),
    9,
    "Weekly capacity must round to whole windows."
  );
  expectEqual(
    popup.exports.normalizeWeeklyWindowCapacity(""),
    9,
    "Blank weekly capacity input must fall back to the default."
  );

  const usage = {
    session: { percentage: 0, resetsAt: null },
    weekly: { percentage: 0, resetsAt: htmlReset },
    lastUpdated: Date.now(),
  };
  const lifecyclePopup = loadPopupExports();
  lifecyclePopup.exports.renderUsage(usage);
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('aria-expanded="false"') &&
      lifecyclePopup.elements.content.innerHTML.includes("data-forecast-settings-toggle"),
    "A newly opened popup must render the collapsed Forecast settings control."
  );
  expectEqual(
    lifecyclePopup.elements.content.innerHTML.includes("weekly-forecast-panel"),
    false,
    "A newly opened popup must keep forecast settings collapsed."
  );
  expectEqual(
    lifecyclePopup.elements.content.innerHTML.includes("data-week-window-toggle"),
    false,
    "A newly opened popup must not render the old today-square toggle."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('value="9"'),
    "A newly opened popup must render the default weekly capacity."
  );

  let preventedDefault = false;
  lifecyclePopup.exports.handleForecastSettingsToggle({
    type: "click",
    target: {
      closest: (selector) => selector === "[data-forecast-settings-toggle]" ? {} : null,
    },
    preventDefault() {
      preventedDefault = true;
    },
  });
  expectTruthy(
    preventedDefault &&
      lifecyclePopup.elements.content.innerHTML.includes('aria-expanded="true"') &&
      lifecyclePopup.elements.content.innerHTML.includes("weekly-forecast-panel") &&
      lifecyclePopup.elements.content.innerHTML.includes("Work weekends") &&
      lifecyclePopup.elements.content.innerHTML.includes("Done today"),
    "Clicking Forecast settings must open the inline checkbox panel."
  );

  const includeWeekendsInput = {
    checked: true,
    dataset: { forecastSetting: "include-weekends" },
    closest: (selector) => selector === "[data-forecast-setting]" ? includeWeekendsInput : null,
  };
  lifecyclePopup.exports.handleForecastSettingsChange({ target: includeWeekendsInput });
  expectEqual(
    lifecyclePopup.storageSets.at(-1)?.includeWeekendsInWeekWindow,
    true,
    "Changing Work weekends must persist weekend inclusion."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('data-forecast-setting="include-weekends" checked'),
    "Work weekends must stay checked after rerender."
  );

  const doneTodayInput = {
    checked: true,
    dataset: { forecastSetting: "done-today" },
    closest: (selector) => selector === "[data-forecast-setting]" ? doneTodayInput : null,
  };
  lifecyclePopup.exports.handleForecastSettingsChange({ target: doneTodayInput });
  expectEqual(
    lifecyclePopup.storageSets.at(-1)?.doneTodayInWeekWindowDate,
    localDateKeyForTest(new Date()),
    "Changing Done today must persist today's local date."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('data-forecast-setting="done-today" checked') &&
      lifecyclePopup.elements.content.innerHTML.includes("day-cell--today-done"),
    "Done today must stay checked and mark today's square after rerender."
  );

  const weeklyWindowInput = { value: "12", closest: (selector) => selector === "#weeklyWindowInput" ? weeklyWindowInput : null };
  lifecyclePopup.exports.handleWeeklyWindowInputChange({ target: weeklyWindowInput });
  expectEqual(
    lifecyclePopup.storageSets.at(-1)?.weeklyFiveHourWindows,
    12,
    "Changing the weekly capacity input must save the normalized value."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('value="12"'),
    "Changing the weekly capacity input must rerender the saved value."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('data-forecast-setting="include-weekends" checked') &&
      lifecyclePopup.elements.content.innerHTML.includes('data-forecast-setting="done-today" checked'),
    "Changing the weekly capacity input must preserve open forecast settings."
  );

  weeklyWindowInput.value = "999";
  lifecyclePopup.exports.handleWeeklyWindowInputChange({ target: weeklyWindowInput });
  expectEqual(
    lifecyclePopup.storageSets.at(-1)?.weeklyFiveHourWindows,
    500,
    "Changing the weekly capacity input must clamp oversized values before saving."
  );

  weeklyWindowInput.value = "-5";
  lifecyclePopup.exports.handleWeeklyWindowInputChange({ target: weeklyWindowInput });
  expectEqual(
    lifecyclePopup.storageSets.at(-1)?.weeklyFiveHourWindows,
    1,
    "Changing the weekly capacity input must clamp undersized values before saving."
  );

  lifecyclePopup.exports.renderUsage({
    ...usage,
    weekly: { percentage: 20, resetsAt: htmlReset },
    lastUpdated: Date.now(),
  });
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('aria-expanded="true"') &&
      lifecyclePopup.elements.content.innerHTML.includes('data-forecast-setting="done-today" checked'),
    "Open forecast settings and done-today state must survive a refresh render while the popup remains open."
  );
  expectTruthy(
    lifecyclePopup.elements.content.innerHTML.includes('value="1"'),
    "Saved weekly capacity must survive a refresh render while the popup remains open."
  );

  const freshPopup = loadPopupExports();
  freshPopup.exports.renderUsage(usage);
  expectTruthy(
    freshPopup.elements.content.innerHTML.includes('aria-expanded="false"') &&
      !freshPopup.elements.content.innerHTML.includes("weekly-forecast-panel"),
    "A fresh popup lifecycle must default the forecast settings panel to closed."
  );

  const todayKey = localDateKeyForTest(new Date());
  const storedPopup = loadPopupExports({
    storageGetResult: {
      usageData: usage,
      weeklyFiveHourWindows: 12,
      includeWeekendsInWeekWindow: true,
      doneTodayInWeekWindowDate: todayKey,
    },
  });
  storedPopup.exports.loadStoredUsage();
  expectTruthy(
    storedPopup.elements.content.innerHTML.includes('value="12"'),
    "Stored weekly capacity must be loaded before the first cached usage render."
  );
  storedPopup.exports.handleForecastSettingsToggle({
    type: "click",
    target: {
      closest: (selector) => selector === "[data-forecast-settings-toggle]" ? {} : null,
    },
    preventDefault() {},
  });
  expectTruthy(
    storedPopup.elements.content.innerHTML.includes('data-forecast-setting="include-weekends" checked') &&
      storedPopup.elements.content.innerHTML.includes('data-forecast-setting="done-today" checked'),
    "Stored forecast preferences must be loaded before the first cached usage render."
  );
  expectTruthy(
    storedPopup.elements.content.innerHTML.includes("5h windows"),
    "Stored weekly capacity must keep the weekly window strip rendered."
  );

  const staleDonePopup = loadPopupExports({
    storageGetResult: {
      usageData: usage,
      doneTodayInWeekWindowDate: "2026-01-01",
    },
  });
  staleDonePopup.exports.loadStoredUsage();
  staleDonePopup.exports.handleForecastSettingsToggle({
    type: "click",
    target: {
      closest: (selector) => selector === "[data-forecast-settings-toggle]" ? {} : null,
    },
    preventDefault() {},
  });
  expectEqual(
    staleDonePopup.elements.content.innerHTML.includes('data-forecast-setting="done-today" checked'),
    false,
    "A stored done-today date from another local day must reset automatically."
  );
}

function loadBackgroundExports(options = {}) {
  const listener = { addListener() {} };
  const storageState = { ...(options.storageGetResult || {}) };
  const storageSets = [];
  const context = {
    chrome: {
      runtime: {
        onInstalled: listener,
        onStartup: listener,
        onMessage: listener,
      },
      alarms: {
        onAlarm: listener,
        create() {},
      },
      cookies: {
        getAll: async () => options.cookiesGetAll || [],
        get: async (details) => typeof options.cookieGet === "function"
          ? options.cookieGet(details)
          : options.cookieGet || null,
      },
      storage: {
        local: {
          get: async (keys) => selectStorageValues(storageState, keys),
          set: async (value) => {
            storageSets.push(value);
            Object.assign(storageState, value);
          },
        },
      },
      action: {
        setBadgeText: options.setBadgeText || (() => {}),
        setBadgeBackgroundColor: options.setBadgeBackgroundColor || (() => {}),
      },
      i18n: {
        getMessage: (key) => key,
      },
    },
    fetch: options.fetch || (async () => ({ ok: false })),
  };

  const exports = loadScriptExports("background.js", context, [
    "refreshUsage",
    "normalizeUsageResponse",
    "updateUsageLog",
    "updateBadge",
  ]);
  exports.__storageSets = storageSets;
  exports.__storageState = storageState;
  return exports;
}

function selectStorageValues(storageState, keys) {
  if (keys === null || keys === undefined) return { ...storageState };

  if (Array.isArray(keys)) {
    return keys.reduce((result, key) => {
      result[key] = storageState[key];
      return result;
    }, {});
  }

  if (typeof keys === "string") {
    return { [keys]: storageState[keys] };
  }

  if (typeof keys === "object") {
    return Object.keys(keys).reduce((result, key) => {
      result[key] = Object.prototype.hasOwnProperty.call(storageState, key)
        ? storageState[key]
        : keys[key];
      return result;
    }, {});
  }

  return { ...storageState };
}

function localDateKeyForTest(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function loadPopupExports(options = {}) {
  const elements = {};
  const storageSets = [];
  const document = {
    documentElement: {},
    body: {
      appendChild() {},
    },
    addEventListener() {},
    querySelectorAll: () => [],
    getElementById(id) {
      if (!elements[id]) elements[id] = createElementStub(id);
      return elements[id];
    },
    createElement: () => createElementStub(),
  };

  const exports = loadScriptExports(
    "popup.js",
    {
      document,
      chrome: {
        i18n: {
          getUILanguage: () => "en",
          getMessage: (key, substitutions = []) => {
            if (key === "dayWindows") return `~${substitutions[0]} × 5h windows`;
            if (key === "dayToday") return "Today";
            if (key === "dayWeekend") return "Weekend · 0 windows";
            if (key === "forecastSettingsLabel") return "Forecast settings";
            if (key === "forecastTitle") return "Forecast";
            if (key === "forecastWorkWeekends") return "Work weekends";
            if (key === "forecastDoneToday") return "Done today";
            if (key === "routines") return "Routines";
            return substitutions.length ? `${key} ${substitutions.join(" ")}` : key;
          },
        },
        runtime: {
          sendMessage(_message, callback) {
            if (typeof callback === "function") callback(null);
          },
        },
        storage: {
          local: {
            get(_keys, callback) {
              if (typeof callback === "function") callback(options.storageGetResult || {});
              return options.storageGetResult || {};
            },
            set(value) {
              storageSets.push(value);
            },
          },
        },
      },
      setInterval() {},
    },
    [
      "renderUsage",
      "barTone",
      "weekWindowDays",
      "weekWindow",
      "handleForecastSettingsToggle",
      "handleForecastSettingsChange",
      "handleWeeklyWindowInputChange",
      "loadStoredUsage",
      "normalizeWeeklyWindowCapacity",
      "formatResetDateTime",
      "usageLogToCsv",
      "csvCell",
      "usageLogFilename",
    ]
  );

  return {
    exports,
    elements,
    storageSets,
  };
}

function loadScriptExports(file, context, names) {
  vm.createContext(context);
  const exportSource = names.map((name) => `${JSON.stringify(name)}: ${name}`).join(",");
  new vm.Script(`${read(file)}\nthis.__exports = {${exportSource}};`, { filename: file }).runInContext(
    context
  );
  return context.__exports;
}

function createElementStub(id = "") {
  let html = "";
  let text = "";
  const classes = new Set();

  return {
    id,
    hidden: false,
    disabled: false,
    title: "",
    dataset: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener() {},
    click() {},
    remove() {},
    setAttribute(name, value) {
      this[name] = value;
    },
    get innerHTML() {
      return html || escapeForTest(text);
    },
    set innerHTML(value) {
      html = String(value);
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = String(value);
      html = "";
    },
  };
}

function escapeForTest(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) errors.push(`${message} Expected ${expected}, got ${actual}.`);
}

function expectTruthy(value, message) {
  if (!value) errors.push(message);
}

function expectArrayEqual(actual, expected, message) {
  if (!Array.isArray(actual)) {
    errors.push(`${message} Value is not an array.`);
    return;
  }
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    errors.push(`${message} Expected ${JSON.stringify(right)}, got ${JSON.stringify(left)}.`);
  }
}
