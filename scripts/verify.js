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
  "never",
  "readingUsage",
  "footerGithubAria",
  "github",
  "openClaude",
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
checkPopupSummaryStatus();
checkBadgeColors();
checkPopupBarTones();

if (errors.length) {
  console.error("Verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Verification passed.");

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

function checkPopupSummaryStatus() {
  const popup = loadPopupExports();

  popup.exports.renderUsage({
    plan: "Pro",
    planDetected: true,
    session: { percentage: 0, resetsAt: null },
    lastUpdated: Date.now(),
  });
  expectEqual(
    popup.elements.updatedValue.textContent,
    "now",
    "Plan fields must not affect the compact Updated status."
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
  });
  expectTruthy(popup.elements.updatedValue.textContent, "Error states must still render the Updated field.");
  expectTruthy(
    popup.elements.content.innerHTML.includes("Usage unavailable"),
    "Error states must still render the error message."
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
    popup.exports.barTone(20, hoursFromNow(72), "weekly"),
    "",
    "Weekly bars with enough quota and a near reset must stay neutral."
  );
  expectEqual(
    popup.exports.barTone(12, hoursFromNow(20), "weekly"),
    "",
    "Weekly bars within one day of reset must avoid warning colors when not critically depleted."
  );
  expectEqual(
    popup.exports.barTone(4, hoursFromNow(20), "weekly"),
    "danger",
    "Weekly bars may stay critical when quota is almost gone even if reset is soon."
  );
  expectEqual(
    popup.exports.barTone(20, hoursFromNow(120), "weekly"),
    "warning",
    "Weekly bars must use normal thresholds when reset is not soon."
  );
}

function loadBackgroundExports(actionOverrides = {}) {
  const listener = { addListener() {} };
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
        getAll: async () => [],
        get: async () => null,
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
      action: {
        setBadgeText: actionOverrides.setBadgeText || (() => {}),
        setBadgeBackgroundColor: actionOverrides.setBadgeBackgroundColor || (() => {}),
      },
      i18n: {
        getMessage: (key) => key,
      },
    },
    fetch: async () => ({ ok: false }),
  };

  return loadScriptExports("background.js", context, [
    "normalizeUsageResponse",
    "updateBadge",
  ]);
}

function loadPopupExports() {
  const elements = {};
  const document = {
    documentElement: {},
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
          getMessage: (key, substitutions = []) =>
            substitutions.length ? `${key} ${substitutions.join(" ")}` : key,
        },
        runtime: {
          sendMessage() {},
        },
        storage: {
          local: {
            get() {},
          },
        },
      },
      setInterval() {},
    },
    ["renderUsage", "barTone"]
  );

  return {
    exports,
    elements,
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
