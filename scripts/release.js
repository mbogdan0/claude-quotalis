const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const version = process.argv[2];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!versionPattern.test(version || "")) {
  console.error("Usage: npm run release -- <version>");
  console.error("Version must use x.y.z format, for example 1.1.0.");
  process.exit(1);
}

updateJson("manifest.json", (manifest) => {
  manifest.version = version;
  return manifest;
});

updateJson("package.json", (packageJson) => {
  packageJson.version = version;
  return packageJson;
});

run("npm", ["run", "build"]);
run("npm", ["run", "verify"]);

console.log(`Release package ready: dist/quotalis-for-claude-${version}.zip`);

function updateJson(file, update) {
  const absolute = path.join(root, file);
  const value = JSON.parse(fs.readFileSync(absolute, "utf8"));
  fs.writeFileSync(absolute, `${JSON.stringify(update(value), null, 2)}\n`);
}

function run(command, args) {
  childProcess.execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
  });
}
