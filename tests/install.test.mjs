import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const bundleHelper = join(repo, "bundle-register.mjs");
const credentialHelper = join(repo, "write-credential.mjs");
const bundleName = "dsh-plugin-bailian";
const pluginFiles = [
  "cordis.patch.yml",
  "package.json",
  "README.md",
  "LICENSE",
  "install.bat",
  "install.ps1",
  "write-credential.mjs",
  "bundle-register.mjs",
];
const key1 = "sk-install-test-1234567890";
const key2 = "sk-install-test-0987654321";

const psProbe = process.platform === "win32"
  ? spawnSync("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
      windowsHide: true,
    })
  : { status: 1, stdout: "" };
const hasPowerShell51 = psProbe.status === 0 && psProbe.stdout.trim() === "5";
const psTest = { skip: !hasPowerShell51, timeout: 60_000 };

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "bailian-install-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  return root;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function copyPlugin(parent) {
  const target = join(parent, "plugin");
  mkdirSync(target, { recursive: true });
  for (const file of pluginFiles) {
    assert.ok(existsSync(join(repo, file)), `missing source fixture: ${file}`);
    copyFileSync(join(repo, file), join(target, file));
  }
  return target;
}

function profileJson() {
  return {
    name: "isolated-test-profile",
    private: true,
    dependencies: { keep: "1.0.0" },
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "keep-bundle"] } },
    untouched: { nested: true },
  };
}

function seedProfile(home, { profile = "desktop", credentials, oldPlugin = false } = {}) {
  const dir = join(home, "profiles", profile);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), profileJson());
  writeFileSync(join(dir, "cordis.patch.yml"), "# user patch must survive\r\n[]\r\n");
  if (credentials !== undefined) writeFileSync(join(home, ".credentials.yaml"), credentials);
  if (oldPlugin) {
    const old = join(dir, "node_modules", bundleName);
    mkdirSync(old, { recursive: true });
    writeJson(join(old, "package.json"), { name: bundleName, version: "0.0.0-old" });
    writeFileSync(join(old, "cordis.patch.yml"), "# old plugin\n[]\n");
    writeFileSync(join(old, "old-only.txt"), "preserve me in backup\n");
  }
  return dir;
}

function output(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function assertSuccess(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label} failed:\n${output(result)}`);
}

function runNode(script, args, { input = "", env = {} } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, NODE_PATH: "", ...env },
    timeout: 20_000,
    windowsHide: true,
  });
}

function runBundle(packagePath, mode) {
  return runNode(bundleHelper, [mode], {
    env: { PKG_JSON: packagePath, BUNDLE_NAME: bundleName },
  });
}

function runInstall(plugin, home, args, extraEnv = {}) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(plugin, "install.ps1"), ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_NODE: process.execPath,
        DSH_PROFILE: "",
        DASHSCOPE_API_KEY: "",
        NODE_PATH: "",
        ...extraEnv,
      },
      timeout: 45_000,
      windowsHide: true,
    },
  );
}

function holdInstallMutex(profile) {
  const script = [
    "$path=[IO.Path]::GetFullPath($env:LOCK_PROFILE).ToLowerInvariant()",
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "$id=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($path))).Replace('-', '')",
    "$sha.Dispose()",
    "$mutex=[Threading.Mutex]::new($false, 'Local\\bailian-' + $id)",
    "if (-not $mutex.WaitOne(0)) { exit 2 }",
    "[Console]::Out.WriteLine('ready')",
    "[Console]::Out.Flush()",
    "[Console]::In.ReadLine() | Out-Null",
    "$mutex.ReleaseMutex()",
    "$mutex.Dispose()",
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
    env: { ...process.env, LOCK_PROFILE: profile },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mutex holder did not become ready: ${stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("ready")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code) => {
      if (!stdout.includes("ready")) {
        clearTimeout(timer);
        reject(new Error(`mutex holder exited ${code}: ${stderr}`));
      }
    });
  });
}

function releaseInstallMutex(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("mutex holder did not exit"));
    }, 10_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`mutex holder exited ${code}`));
    });
    child.stdin.end("\n");
  });
}

function snapshotTree(root) {
  if (!existsSync(root)) return [];
  const snapshot = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = relative(root, path).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        snapshot.push([name, "dir"]);
        visit(path);
      } else {
        snapshot.push([name, "file", readFileSync(path).toString("base64")]);
      }
    }
  }
  visit(root);
  return snapshot.sort((a, b) => a[0].localeCompare(b[0]));
}

function backups(profile) {
  return readdirSync(profile, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".bailian-backup-"))
    .map((entry) => join(profile, entry.name));
}

test("model catalog keeps the reviewed 14-model capabilities", () => {
  const patch = readFileSync(join(repo, "cordis.patch.yml"), "utf8");
  const matches = [...patch.matchAll(/^ {14}- id: ([^\r\n]+)$/gm)];
  const models = new Map(matches.map((match, index) => [
    match[1],
    patch.slice(match.index, matches[index + 1]?.index ?? patch.indexOf("\n    # ---", match.index)),
  ]));
  const expected = [
    "MiniMax-M2.5",
    "MiniMax/MiniMax-M3",
    "deepseek-v4-pro",
    "deepseek-v4-pro-0813",
    "deepseek-v4-flash-0731",
    "deepseek-v4.1-flash",
    "glm-5.2",
    "glm-5.3",
    "kimi-k2.6",
    "kimi-k3",
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.8-max",
    "qwen3.8-max-0902",
  ].sort();
  assert.deepEqual([...models.keys()].sort(), expected);
  assert.deepEqual(
    [...models].filter(([, block]) => /input:\s*\[text, image\]/.test(block)).map(([id]) => id).sort(),
    [
      "MiniMax/MiniMax-M3",
      "deepseek-v4.1-flash",
      "kimi-k2.6",
      "kimi-k3",
      "qwen3.7-plus",
      "qwen3.8-max",
      "qwen3.8-max-0902",
    ].sort(),
  );
  assert.match(models.get("kimi-k2.6"), /maxTokens:\s*16384\b/);
  assert.match(models.get("kimi-k3"), /contextWindow:\s*1048576\b[\s\S]*maxTokens:\s*1048576\b/);
  assert.match(models.get("MiniMax/MiniMax-M3"), /contextWindow:\s*1048576\b[\s\S]*input:\s*\[text, image\]/);
  assert.doesNotMatch(models.get("glm-5.3"), /^\s+off:/m);
});

test("bundle helper registers idempotently, validates, and unregisters without collateral edits", (t) => {
  const root = temporary(t);
  const pkg = join(root, "package.json");
  const original = profileJson();
  original.dependencies[bundleName] = "wrong-value";
  writeJson(pkg, original);

  const beforeValidate = readFileSync(pkg, "utf8");
  assertSuccess(runBundle(pkg, "validate"), "validate");
  assert.equal(readFileSync(pkg, "utf8"), beforeValidate, "validate must be read-only");

  assertSuccess(runBundle(pkg, "register"), "register");
  assertSuccess(runBundle(pkg, "register"), "repeated register");
  let json = JSON.parse(readFileSync(pkg, "utf8"));
  assert.equal(json.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  assert.equal(json.dependencies[bundleName], `file:./node_modules/${bundleName}`);
  assert.equal(json.dependencies.keep, "1.0.0");
  assert.deepEqual(json.untouched, { nested: true });

  json.dsh.profile.bundles.push(bundleName);
  writeJson(pkg, json);
  assertSuccess(runBundle(pkg, "unregister"), "unregister");
  json = JSON.parse(readFileSync(pkg, "utf8"));
  assert.equal(json.dsh.profile.bundles.includes(bundleName), false);
  assert.equal(bundleName in json.dependencies, false);
  assert.equal(json.dependencies.keep, "1.0.0");

  writeFileSync(pkg, '{"dsh":{"profile":{"bundles":"not-an-array"}}}\n');
  const invalid = readFileSync(pkg, "utf8");
  const rejected = runBundle(pkg, "validate");
  assert.notEqual(rejected.status, 0);
  assert.equal(readFileSync(pkg, "utf8"), invalid, "invalid profile must remain byte-for-byte intact");
  assert.equal(existsSync(`${pkg}.bailian-tmp`), false);
});

test("credential helper reads stdin, preserves CRLF and unrelated data, and never prints the key", (t) => {
  const root = temporary(t);
  const creds = join(root, ".credentials.yaml");
  const key = "sk-credential-test_123456";
  writeFileSync(
    creds,
    "version: 1\r\nrefs:\r\n  OTHER_TOKEN: keep-me\r\nrecords:\r\n  existing:\r\n    type: literal\r\n    value: keep-record\r\n",
  );

  const result = runNode(credentialHelper, [creds], {
    input: `${key}\n`,
    env: { DSH_PROFILES: join(root, "profiles") },
  });
  assertSuccess(result, "credential update");
  assert.equal(output(result).includes(key), false, "full key leaked to output");
  const updated = readFileSync(creds, "utf8");
  assert.equal(updated.replaceAll("\r\n", "").includes("\n"), false, "CRLF was not preserved");
  assert.match(updated, /OTHER_TOKEN: keep-me/);
  assert.match(updated, /value: keep-record/);
  assert.match(updated, /DASHSCOPE_API_KEY: ["']?sk-credential-test_123456["']?/);
  assert.ok(updated.indexOf("DASHSCOPE_API_KEY") < updated.indexOf("records:"));

  const argvOnly = readFileSync(creds, "utf8");
  const rejectedArgv = runNode(credentialHelper, [creds, key], {
    env: { DSH_PROFILES: join(root, "profiles") },
  });
  assert.notEqual(rejectedArgv.status, 0, "key must not be accepted through argv");
  assert.equal(readFileSync(creds, "utf8"), argvOnly);
  assert.equal(output(rejectedArgv).includes(key), false);
});

test("credential helper rejects injection and ambiguous fallback YAML without touching the file", (t) => {
  const root = temporary(t);
  const creds = join(root, ".credentials.yaml");
  const cases = [
    ["newline injection", "version: 1\nrefs: {}\nrecords: {}\n", "sk-safe\nrecords:\n  injected: yes\n"],
    ["non-empty inline refs", "version: 1\nrefs: { OTHER_TOKEN: keep }\nrecords: {}\n", `${key1}\n`],
    ["duplicate refs", "version: 1\nrefs:\n  A: one\nrefs:\n  B: two\nrecords: {}\n", `${key1}\n`],
    ["duplicate credential", "version: 1\nrefs:\n  DASHSCOPE_API_KEY: one\n  DASHSCOPE_API_KEY: two\nrecords: {}\n", `${key1}\n`],
    ["non-mapping refs", "version: 1\nrefs: []\nrecords: {}\n", `${key1}\n`],
    ["unknown top-level key", "version: 1\nrefs: {}\nrecords: {}\nsurprise: no\n", `${key1}\n`],
  ];

  for (const [label, source, input] of cases) {
    writeFileSync(creds, source);
    const result = runNode(credentialHelper, [creds], {
      input,
      env: { DSH_PROFILES: join(root, "profiles") },
    });
    assert.notEqual(result.status, 0, `${label} was accepted`);
    assert.equal(readFileSync(creds, "utf8"), source, `${label} changed the original file`);
    assert.equal(readdirSync(root).some((name) => name.includes(".bailian-") && name.endsWith(".tmp")), false);
    assert.equal(output(result).includes(input.trim()), false, `${label} leaked input`);
  }
});

test("integration tests run against Windows PowerShell 5.1", psTest, () => {
  assert.equal(psProbe.stdout.trim(), "5");
});

test("PowerShell 5.1 installs, repeats from the installed copy, and uninstalls safely", psTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  const credentials = "version: 1\r\nrefs:\r\n  OTHER_TOKEN: keep-me\r\nrecords: {}\r\n";
  const profile = seedProfile(home, { credentials, oldPlugin: true });
  const userPatch = readFileSync(join(profile, "cordis.patch.yml"), "utf8");

  const first = runInstall(plugin, home, ["-NonInteractive", "-ApiKey", key1, "-SkipVerify"]);
  assertSuccess(first, "first install");
  assert.equal(output(first).includes(key1), false, "install leaked the full key");

  const installed = join(profile, "node_modules", bundleName);
  for (const file of pluginFiles) assert.ok(existsSync(join(installed, file)), `installed copy missing ${file}`);
  assert.equal(existsSync(join(installed, "old-only.txt")), false, "stale plugin files survived replacement");
  const firstJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(firstJson.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  assert.equal(firstJson.dependencies[bundleName], `file:./node_modules/${bundleName}`);
  assert.equal(firstJson.dependencies.keep, "1.0.0");
  assert.deepEqual(firstJson.untouched, { nested: true });
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), userPatch);
  const firstCreds = readFileSync(join(home, ".credentials.yaml"), "utf8");
  assert.match(firstCreds, /OTHER_TOKEN: keep-me/);
  assert.match(firstCreds, new RegExp(key1));
  assert.ok(
    backups(profile).some((backup) => existsSync(join(backup, "plugin", "old-only.txt"))),
    "old plugin was not backed up under backup/plugin",
  );

  const repeated = runInstall(installed, home, ["-NonInteractive", "-ApiKey", key2, "-SkipVerify"]);
  assertSuccess(repeated, "repeat install from installed copy");
  assert.equal(output(repeated).includes(key2), false, "repeat install leaked the full key");
  const repeatedJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(repeatedJson.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  const repeatedCreds = readFileSync(join(home, ".credentials.yaml"), "utf8");
  assert.equal(repeatedCreds.includes(key1), false);
  assert.match(repeatedCreds, new RegExp(key2));
  assert.match(repeatedCreds, /OTHER_TOKEN: keep-me/);

  const beforeUninstallCreds = readFileSync(join(home, ".credentials.yaml"), "utf8");
  const removed = runInstall(installed, home, ["-Uninstall", "-NonInteractive", "-SkipVerify"]);
  assertSuccess(removed, "uninstall");
  assert.equal(existsSync(installed), false, "plugin directory survived uninstall");
  const removedJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(removedJson.dsh.profile.bundles.includes(bundleName), false);
  assert.equal(bundleName in removedJson.dependencies, false);
  assert.equal(removedJson.dependencies.keep, "1.0.0");
  assert.deepEqual(removedJson.untouched, { nested: true });
  assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), beforeUninstallCreds);
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), userPatch);
});

test("PowerShell DryRun and Uninstall DryRun perform zero writes", psTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  seedProfile(home, {
    credentials: "version: 1\nrefs:\n  OTHER_TOKEN: keep\nrecords: {}\n",
    oldPlugin: true,
  });
  const before = snapshotTree(home);

  const installDryRun = runInstall(plugin, home, [
    "-DryRun", "-NonInteractive", "-ApiKey", key1, "-SkipVerify",
  ]);
  assertSuccess(installDryRun, "install dry-run");
  assert.equal(output(installDryRun).includes(key1), false);
  assert.deepEqual(snapshotTree(home), before, "install dry-run changed DSH_HOME");

  const uninstallDryRun = runInstall(plugin, home, ["-Uninstall", "-DryRun", "-NonInteractive", "-SkipVerify"]);
  assertSuccess(uninstallDryRun, "uninstall dry-run");
  assert.deepEqual(snapshotTree(home), before, "uninstall dry-run changed DSH_HOME");
});

test("PowerShell rejects profile traversal and invalid source/profile before writing", psTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);

  const traversalHome = join(root, "traversal-home");
  const escaped = join(traversalHome, "escape");
  mkdirSync(escaped, { recursive: true });
  writeJson(join(escaped, "package.json"), profileJson());
  writeFileSync(join(escaped, "cordis.patch.yml"), "[]\n");
  const traversalBefore = snapshotTree(traversalHome);
  const traversal = runInstall(plugin, traversalHome, ["-Profile", "..\\escape", "-NonInteractive", "-SkipVerify"]);
  assert.notEqual(traversal.status, 0, `profile traversal succeeded:\n${output(traversal)}`);
  assert.deepEqual(snapshotTree(traversalHome), traversalBefore);

  const badSourceHome = join(root, "bad-source-home");
  seedProfile(badSourceHome);
  const badPlugin = copyPlugin(join(root, "bad-source"));
  writeFileSync(join(badPlugin, "package.json"), "{ invalid json\n");
  const badSourceBefore = snapshotTree(badSourceHome);
  const badSource = runInstall(badPlugin, badSourceHome, ["-NonInteractive", "-SkipVerify"]);
  assert.notEqual(badSource.status, 0, `invalid source package succeeded:\n${output(badSource)}`);
  assert.deepEqual(snapshotTree(badSourceHome), badSourceBefore);

  const badProfileHome = join(root, "bad-profile-home");
  const badProfile = seedProfile(badProfileHome);
  writeJson(join(badProfile, "package.json"), { dsh: { profile: { bundles: "not-an-array" } } });
  const badProfileBefore = snapshotTree(badProfileHome);
  const invalidProfile = runInstall(plugin, badProfileHome, ["-NonInteractive", "-SkipVerify"]);
  assert.notEqual(invalidProfile.status, 0, `invalid profile succeeded:\n${output(invalidProfile)}`);
  assert.deepEqual(snapshotTree(badProfileHome), badProfileBefore);
});

test("PowerShell rolls back when credential structure is unsafe", psTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  const unsafe = "version: 1\nrefs: { OTHER_TOKEN: keep }\nrecords: {}\n";
  const profile = seedProfile(home, { credentials: unsafe, oldPlugin: true });
  const packageBefore = readFileSync(join(profile, "package.json"), "utf8");
  const patchBefore = readFileSync(join(profile, "cordis.patch.yml"), "utf8");
  const oldBefore = snapshotTree(join(profile, "node_modules", bundleName));

  const result = runInstall(plugin, home, ["-NonInteractive", "-ApiKey", key1, "-SkipVerify"]);
  assert.notEqual(result.status, 0, `unsafe credentials succeeded:\n${output(result)}`);
  assert.equal(output(result).includes(key1), false);
  assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), unsafe);
  assert.equal(readFileSync(join(profile, "package.json"), "utf8"), packageBefore);
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), patchBefore);
  assert.deepEqual(snapshotTree(join(profile, "node_modules", bundleName)), oldBefore);
});

test("PowerShell rolls back package, credentials, and plugin when registration fails", psTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  writeFileSync(
    join(plugin, "bundle-register.mjs"),
    'if (process.argv[2] === "validate") process.exit(0);\n' +
      'console.error("forced register failure");\nprocess.exit(7);\n',
  );
  const home = join(root, "home");
  const credentials = "version: 1\nrefs:\n  DASHSCOPE_API_KEY: sk-old-test-key\nrecords: {}\n";
  const profile = seedProfile(home, { credentials, oldPlugin: true });
  const packageBefore = readFileSync(join(profile, "package.json"), "utf8");
  const patchBefore = readFileSync(join(profile, "cordis.patch.yml"), "utf8");
  const oldBefore = snapshotTree(join(profile, "node_modules", bundleName));

  const result = runInstall(plugin, home, ["-NonInteractive", "-ApiKey", key1, "-SkipVerify"]);
  assert.notEqual(result.status, 0, `forced registration failure succeeded:\n${output(result)}`);
  assert.match(output(result), /forced register failure/);
  assert.equal(output(result).includes(key1), false);
  assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), credentials);
  assert.equal(readFileSync(join(profile, "package.json"), "utf8"), packageBefore);
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), patchBefore);
  assert.deepEqual(snapshotTree(join(profile, "node_modules", bundleName)), oldBefore);
});

test("concurrent installer is rejected before any profile writes", psTest, async (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  const profile = seedProfile(home);
  const lockId = createHash("sha256").update(profile.toLowerCase()).digest("hex").toUpperCase();
  const guard = spawn("powershell.exe", ["-NoProfile", "-Command",
    `$guard = [Threading.Mutex]::new($false, 'Local\\bailian-${lockId}'); ` +
    `$null = $guard.WaitOne(0); Write-Output 'READY'; Start-Sleep -Seconds 30; $guard.ReleaseMutex(); $guard.Dispose()`],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => guard.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("mutex holder did not start")), 10_000);
    guard.once("error", (error) => { clearTimeout(timeout); reject(error); });
    guard.stdout.on("data", (data) => { if (String(data).includes("READY")) { clearTimeout(timeout); resolve(); } });
  });
  const before = snapshotTree(home);
  const result = runInstall(plugin, home, ["-NonInteractive", "-SkipVerify"]);
  assert.notEqual(result.status, 0);
  assert.match(output(result), /Another installer/);
  assert.deepEqual(snapshotTree(home), before);
});

test("installer runs using the explicitly selected Harness bundled Node", {
  ...psTest, skip: !hasPowerShell51 || !process.env.BAILIAN_TEST_NODE,
}, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  seedProfile(home);
  assertSuccess(runInstall(plugin, home, ["-NonInteractive", "-SkipVerify"], {
    DSH_NODE: process.env.BAILIAN_TEST_NODE,
  }), "bundled Node install");
});
