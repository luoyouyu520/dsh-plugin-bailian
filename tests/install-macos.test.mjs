import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const bundleName = "dsh-plugin-bailian";
const requiredFiles = [
  "package.json", "cordis.patch.yml", "install.sh", "write-credential.mjs", "bundle-register.mjs",
];
const publicFiles = [...requiredFiles, "README.md", "LICENSE", "CHANGELOG.md", "TEST-REPORT.txt", "install.command"];
const key1 = "sk-macos-install-test-1234567890";
const key2 = "sk-macos-install-test-0987654321";
const bashTest = { skip: !existsSync("/bin/bash"), timeout: 45_000 };

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "bailian-macos-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  return root;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function copyPlugin(parent) {
  const target = join(parent, "插件 with spaces");
  mkdirSync(target, { recursive: true });
  for (const file of requiredFiles) assert.ok(existsSync(join(repo, file)), `missing source fixture: ${file}`);
  for (const file of publicFiles) {
    if (existsSync(join(repo, file))) copyFileSync(join(repo, file), join(target, file));
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
  if (credentials !== undefined) writeFileSync(join(home, ".credentials.yaml"), credentials, { mode: 0o600 });
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

function runInstall(plugin, home, args = [], extraEnv = {}) {
  return spawnSync("/bin/bash", [join(plugin, "install.sh"), "--non-interactive", "--skip-verify", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_NODE: process.execPath,
      DSH_PROFILE: "desktop",
      DASHSCOPE_API_KEY: "",
      NODE_PATH: "",
      ...extraEnv,
    },
    timeout: 30_000,
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
        snapshot.push([name, "file", statSync(path).mode & 0o777, readFileSync(path).toString("base64")]);
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

test("Mac installer is valid in the system Bash (3.2 on macOS)", bashTest, () => {
  const version = spawnSync("/bin/bash", ["-c", "printf '%s' \"$BASH_VERSION\""], { encoding: "utf8" });
  assertSuccess(version, "Bash version");
  if (process.platform === "darwin") assert.match(version.stdout, /^3\.2\./);
  assertSuccess(spawnSync("/bin/bash", ["-n", join(repo, "install.sh")], { encoding: "utf8" }), "Bash syntax");
});

test("Mac install upgrades, reruns from its installed copy, and uninstalls without changing user settings", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  writeFileSync(join(plugin, "dashscope.key"), "sk-unused-file-test-key\n", { mode: 0o600 });
  const home = join(root, "DSH home 中文");
  const profile = seedProfile(home, {
    credentials: "version: 1\r\nrefs:\r\n  OTHER_TOKEN: keep-me\r\nrecords: {}\r\n",
    oldPlugin: true,
  });
  const userPatch = readFileSync(join(profile, "cordis.patch.yml"), "utf8");
  const oldPluginBefore = snapshotTree(join(profile, "node_modules", bundleName));

  const first = runInstall(plugin, home, [], { DASHSCOPE_API_KEY: key1 });
  assertSuccess(first, "upgrade");
  assert.equal(output(first).includes(key1), false, "install leaked the full key");
  const installed = join(profile, "node_modules", bundleName);
  for (const file of requiredFiles) assert.ok(existsSync(join(installed, file)), `installed copy missing ${file}`);
  assert.equal(existsSync(join(installed, "old-only.txt")), false, "stale plugin files survived replacement");
  assert.equal(existsSync(join(installed, "dashscope.key")), false, "private key file was copied into the installed plugin");
  assert.equal(existsSync(join(profile, ".bailian-install.lock")), false, "installer left its lock behind");
  const firstJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(firstJson.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  assert.equal(firstJson.dependencies[bundleName], `file:./node_modules/${bundleName}`);
  assert.equal(firstJson.dependencies.keep, "1.0.0");
  assert.deepEqual(firstJson.untouched, { nested: true });
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), userPatch);
  const firstCreds = readFileSync(join(home, ".credentials.yaml"), "utf8");
  assert.match(firstCreds, /OTHER_TOKEN: keep-me/);
  assert.ok(firstCreds.includes(key1));
  assert.equal(statSync(join(home, ".credentials.yaml")).mode & 0o777, 0o600);
  assert.ok(backups(profile).some((backup) =>
    JSON.stringify(snapshotTree(join(backup, "plugin"))) === JSON.stringify(oldPluginBefore)),
  "old plugin was not fully backed up");
  for (const backup of backups(profile)) {
    assert.equal(statSync(backup).mode & 0o077, 0, "backup directory exposes credentials to other users");
  }

  const repeated = runInstall(installed, home, [], { DASHSCOPE_API_KEY: key2 });
  assertSuccess(repeated, "repeat install from installed copy");
  assert.equal(output(repeated).includes(key2), false, "repeat install leaked the full key");
  const repeatedJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(repeatedJson.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  const repeatedCreds = readFileSync(join(home, ".credentials.yaml"), "utf8");
  assert.equal(repeatedCreds.includes(key1), false);
  assert.ok(repeatedCreds.includes(key2));
  assert.match(repeatedCreds, /OTHER_TOKEN: keep-me/);

  assertSuccess(runInstall(installed, home), "upgrade retaining existing credentials");
  assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), repeatedCreds);
  const removed = runInstall(installed, home, ["--uninstall"]);
  assertSuccess(removed, "uninstall from installed copy");
  assert.equal(existsSync(installed), false, "plugin directory survived uninstall");
  const removedJson = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
  assert.equal(removedJson.dsh.profile.bundles.includes(bundleName), false);
  assert.equal(bundleName in removedJson.dependencies, false);
  assert.equal(removedJson.dependencies.keep, "1.0.0");
  assert.deepEqual(removedJson.untouched, { nested: true });
  assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), repeatedCreds);
  assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), userPatch);
  assert.equal(existsSync(join(profile, ".bailian-install.lock")), false);
});

test("Mac install and uninstall dry-runs leave DSH_HOME byte-for-byte unchanged", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  seedProfile(home, { credentials: "version: 1\nrefs:\n  OTHER_TOKEN: keep\nrecords: {}\n", oldPlugin: true });
  const before = snapshotTree(home);
  for (const args of [["--dry-run"], ["--uninstall", "--dry-run"]]) {
    const result = runInstall(plugin, home, args, { DASHSCOPE_API_KEY: key1 });
    assertSuccess(result, args.join(" "));
    assert.equal(output(result).includes(key1), false, "dry-run leaked the full key");
    assert.deepEqual(snapshotTree(home), before, "dry-run changed DSH_HOME");
  }
});

test("Mac installer rejects traversal, damaged source, invalid profile, and invalid key before writing", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  for (const traversal of ["../escape", "..\\escape"]) {
    const home = join(root, `traversal-${traversal.includes("\\") ? "backslash" : "slash"}`);
    seedProfile(home);
    const escaped = join(home, "escape");
    writeJson(join(escaped, "package.json"), profileJson());
    writeFileSync(join(escaped, "cordis.patch.yml"), "[]\n");
    const before = snapshotTree(home);
    const result = runInstall(plugin, home, [], { DSH_PROFILE: traversal });
    assert.notEqual(result.status, 0, `traversal succeeded: ${traversal}`);
    assert.deepEqual(snapshotTree(home), before);
  }
  for (const corrupt of ["source-json", "source-helper", "profile-json", "profile-shape", "key"]) {
    const target = copyPlugin(join(root, corrupt));
    const home = join(root, `${corrupt}-home`);
    const profile = seedProfile(home);
    const env = {};
    if (corrupt === "source-json") writeFileSync(join(target, "package.json"), "{ invalid json\n");
    if (corrupt === "source-helper") rmSync(join(target, "write-credential.mjs"));
    if (corrupt === "profile-json") writeFileSync(join(profile, "package.json"), "{ invalid json\n");
    if (corrupt === "profile-shape") writeJson(join(profile, "package.json"), { dsh: { profile: { bundles: "not-an-array" } } });
    if (corrupt === "key") env.DASHSCOPE_API_KEY = "sk-bad\nINJECTED: bad";
    const before = snapshotTree(home);
    const result = runInstall(target, home, [], env);
    assert.notEqual(result.status, 0, `invalid ${corrupt} succeeded:\n${output(result)}`);
    assert.deepEqual(snapshotTree(home), before, `invalid ${corrupt} changed DSH_HOME`);
  }
});

test("Mac installer protects unsupported credentials and rolls back failed registration", bashTest, (t) => {
  const root = temporary(t);
  for (const failure of ["credentials", "registration"]) {
    const plugin = copyPlugin(join(root, failure));
    if (failure === "registration") {
      writeFileSync(join(plugin, "bundle-register.mjs"),
        'if (process.argv[2] === "validate") process.exit(0);\n' +
        'console.error("forced register failure");\nprocess.exit(7);\n');
    }
    const home = join(root, `${failure}-home`);
    const credentials = failure === "credentials"
      ? "version: 1\nrefs: { OTHER_TOKEN: keep }\nrecords: {}\n"
      : "version: 1\nrefs:\n  DASHSCOPE_API_KEY: sk-old-test-key\nrecords: {}\n";
    const profile = seedProfile(home, { credentials, oldPlugin: true });
    const packageBefore = readFileSync(join(profile, "package.json"), "utf8");
    const patchBefore = readFileSync(join(profile, "cordis.patch.yml"), "utf8");
    const oldBefore = snapshotTree(join(profile, "node_modules", bundleName));
    const result = runInstall(plugin, home, [], { DASHSCOPE_API_KEY: key1 });
    assert.notEqual(result.status, 0, `${failure} failure unexpectedly succeeded:\n${output(result)}`);
    assert.equal(output(result).includes(key1), false, "failure output leaked the full key");
    if (failure === "registration") assert.match(output(result), /forced register failure/);
    assert.equal(readFileSync(join(home, ".credentials.yaml"), "utf8"), credentials);
    assert.equal(statSync(join(home, ".credentials.yaml")).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(profile, "package.json"), "utf8"), packageBefore);
    assert.equal(readFileSync(join(profile, "cordis.patch.yml"), "utf8"), patchBefore);
    assert.deepEqual(snapshotTree(join(profile, "node_modules", bundleName)), oldBefore);
    assert.equal(existsSync(join(profile, ".bailian-install.lock")), false, "failure left installer locked");
  }
});

test("Mac installer removes newly created credentials and plugin after registration failure", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  writeFileSync(join(plugin, "bundle-register.mjs"),
    'if (process.argv[2] === "validate") process.exit(0);\nprocess.exit(7);\n');
  const home = join(root, "home");
  const profile = seedProfile(home);
  const packageBefore = readFileSync(join(profile, "package.json"), "utf8");
  const result = runInstall(plugin, home, [], { DASHSCOPE_API_KEY: key1 });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(profile, "package.json"), "utf8"), packageBefore);
  assert.equal(existsSync(join(home, ".credentials.yaml")), false);
  assert.equal(existsSync(join(profile, "node_modules", bundleName)), false);
  assert.equal(existsSync(join(profile, ".bailian-install.lock")), false);
});

test("Mac installer refuses a concurrent installation before profile writes", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  const profile = seedProfile(home);
  const lock = join(profile, ".bailian-install.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), `${process.pid}\n`);
  const before = snapshotTree(home);
  const result = runInstall(plugin, home);
  assert.notEqual(result.status, 0, "concurrent installer succeeded");
  assert.match(output(result), /Another installer/);
  assert.deepEqual(snapshotTree(home), before, "refused installer modified DSH_HOME");
});

test("Mac installer uses selected bundled Node without system Node and respects DSH_PROFILE", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  const desktop = seedProfile(home);
  const web = seedProfile(home, { profile: "web" });
  const desktopBefore = snapshotTree(desktop);
  writeFileSync(join(plugin, "dashscope.key"), `${key1}\n`, { mode: 0o600 });
  assertSuccess(runInstall(plugin, home, [], {
    DSH_PROFILE: "web", DSH_NODE: process.execPath, PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  }), "explicit bundled Node install");
  assert.deepEqual(snapshotTree(desktop), desktopBefore, "web install changed desktop profile");
  const json = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
  assert.ok(json.dsh.profile.bundles.includes(bundleName));
  assert.ok(readFileSync(join(home, ".credentials.yaml"), "utf8").includes(key1));
  assert.equal(statSync(join(home, ".credentials.yaml")).mode & 0o777, 0o600);
});

test("Mac installer sends its key to the credential helper without process arguments", bashTest, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  seedProfile(home);
  const argvLog = join(root, "node arguments.log");
  const wrapper = join(root, "node wrapper.sh");
  const quotedNode = `'${process.execPath.replaceAll("'", "'\\''")}'`;
  writeFileSync(wrapper,
    '#!/bin/bash\nprintf "%s\\n" "$@" >> "$BAILIAN_ARGV_LOG"\n' +
    `exec ${quotedNode} "$@"\n`);
  chmodSync(wrapper, 0o700);
  assertSuccess(runInstall(plugin, home, [], {
    DSH_NODE: wrapper, DASHSCOPE_API_KEY: key1, BAILIAN_ARGV_LOG: argvLog,
  }), "install using instrumented Node");
  const argv = readFileSync(argvLog, "utf8");
  assert.ok(argv.includes("write-credential.mjs"), "credential helper was never invoked");
  assert.equal(argv.includes(key1), false, "key appeared in a Node process command line");
  assert.ok(readFileSync(join(home, ".credentials.yaml"), "utf8").includes(key1));
});

test("Mac installer discovers the installed Harness runtime when no Node is on PATH", {
  ...bashTest,
  skip: process.platform !== "darwin" || !existsSync("/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"),
}, (t) => {
  const root = temporary(t);
  const plugin = copyPlugin(root);
  const home = join(root, "home");
  seedProfile(home);
  assertSuccess(runInstall(plugin, home, [], { DSH_NODE: "", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }), "runtime auto-discovery");
});
