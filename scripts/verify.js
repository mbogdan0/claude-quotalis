const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const publishableFiles = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "README.md",
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
checkJavaScriptSyntax("background.js");
checkJavaScriptSyntax("popup.js");
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
  expectArrayEqual(manifest.permissions, ["cookies", "alarms", "storage"], "Unexpected permissions.");
  expectArrayEqual(manifest.host_permissions, ["https://claude.ai/*"], "Unexpected host permissions.");
  if (manifest.content_scripts) errors.push("Content scripts are not expected.");
  if (manifest.externally_connectable) errors.push("External connections are not expected.");
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
  const zipPath = path.join(root, "dist", "quotalis-for-claude-1.0.0.zip");
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
