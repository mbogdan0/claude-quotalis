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
  "summaryPlanLabel",
  "summaryUpdatedLabel",
  "unknown",
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
checkUsagePlanNormalization();
checkPopupPlanVisibility();

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

function checkUsagePlanNormalization() {
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

  const unknownPlan = background.normalizeUsageResponse(usagePayload, "usage");
  expectEqual(unknownPlan.plan, null, "Usage payload without a plan signal must not guess a plan.");
  expectEqual(unknownPlan.planDetected, false, "Usage payload without a plan signal must set planDetected false.");

  const freePlan = background.normalizeUsageResponse(
    { ...usagePayload, subscription_type: "claude_free" },
    "usage"
  );
  expectEqual(freePlan.plan, "Free", "Explicit claude_free signal must normalize to Free.");
  expectEqual(freePlan.planDetected, true, "Explicit claude_free signal must set planDetected true.");

  const proPlan = background.normalizeUsageResponse({ ...usagePayload, plan: "claude_pro" }, "usage");
  expectEqual(proPlan.plan, "Pro", "Explicit claude_pro signal must normalize to Pro.");
  expectEqual(proPlan.planDetected, true, "Explicit claude_pro signal must set planDetected true.");

  expectEqual(
    background.detectPlan({ feature: "omelette_promotional" }),
    null,
    "Promotional strings must not be treated as Pro."
  );
  expectEqual(
    background.detectOrganizationPlan({ capabilities: { omelette_promotional: true } }),
    null,
    "Promotional capability keys must not be treated as Pro."
  );
  expectEqual(
    background.detectOrganizationPlan({ capabilities: { claude_pro: true } }),
    "Pro",
    "Explicit claude_pro capability keys must normalize to Pro."
  );
}

function checkPopupPlanVisibility() {
  const popup = loadPopupExports();

  popup.exports.renderUsage({
    plan: "Pro",
    session: { percentage: 0, resetsAt: null },
    lastUpdated: Date.now(),
  });
  expectEqual(
    popup.elements.planSummaryItem.hidden,
    true,
    "Cached usage without planDetected must hide the Plan field."
  );
  expectEqual(
    popup.elements.summary.classList.contains("is-plan-hidden"),
    true,
    "Hidden Plan state must use the compact summary layout."
  );

  popup.exports.renderUsage({
    plan: "Free",
    planDetected: true,
    session: { percentage: 0, resetsAt: null },
    lastUpdated: Date.now(),
  });
  expectEqual(popup.elements.planSummaryItem.hidden, false, "Detected plans must show the Plan field.");
  expectEqual(popup.elements.planValue.textContent, "Free", "Detected plans must render their label.");
  expectEqual(
    popup.elements.summary.classList.contains("is-plan-hidden"),
    false,
    "Visible Plan state must use the two-column summary layout."
  );

  popup.exports.renderUsage({
    error: "Usage unavailable",
    hint: "Try again later.",
    lastUpdated: Date.now(),
  });
  expectEqual(popup.elements.planSummaryItem.hidden, true, "Error states must hide the Plan field.");
  expectTruthy(popup.elements.updatedValue.textContent, "Error states must still render the Updated field.");
  expectTruthy(
    popup.elements.content.innerHTML.includes("Usage unavailable"),
    "Error states must still render the error message."
  );
}

function loadBackgroundExports() {
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
        setBadgeText() {},
        setBadgeBackgroundColor() {},
      },
      i18n: {
        getMessage: (key) => key,
      },
    },
    fetch: async () => ({ ok: false }),
  };

  return loadScriptExports("background.js", context, [
    "normalizeUsageResponse",
    "detectPlan",
    "detectOrganizationPlan",
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
    ["renderUsage", "shouldShowPlan"]
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
