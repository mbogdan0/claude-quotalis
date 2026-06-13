const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const requiredLocales = ["en", "uk", "de", "fr", "es"];
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

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) errors.push(`${message} Expected ${expected}, got ${actual}.`);
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
