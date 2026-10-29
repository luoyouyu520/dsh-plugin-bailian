import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const bundleHelper = join(repo, "bundle-register.mjs");
const credentialHelper = join(repo, "write-credential.mjs");
const bundleName = "dsh-plugin-bailian";
const key1 = "sk-install-test-1234567890";

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "bailian-helper-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
  });
}

function runBundle(packagePath, mode) {
  return runNode(bundleHelper, [mode], {
    env: { PKG_JSON: packagePath, BUNDLE_NAME: bundleName },
  });
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
  if (process.platform !== "win32") chmodSync(pkg, 0o640);

  const beforeValidate = readFileSync(pkg, "utf8");
  assertSuccess(runBundle(pkg, "validate"), "validate");
  assert.equal(readFileSync(pkg, "utf8"), beforeValidate, "validate must be read-only");
  if (process.platform !== "win32") assert.equal(statSync(pkg).mode & 0o777, 0o640);

  assertSuccess(runBundle(pkg, "register"), "register");
  assertSuccess(runBundle(pkg, "register"), "repeated register");
  let json = JSON.parse(readFileSync(pkg, "utf8"));
  assert.equal(json.dsh.profile.bundles.filter((name) => name === bundleName).length, 1);
  assert.equal(json.dependencies[bundleName], `file:./node_modules/${bundleName}`);
  assert.equal(json.dependencies.keep, "1.0.0");
  assert.deepEqual(json.untouched, { nested: true });
  if (process.platform !== "win32") assert.equal(statSync(pkg).mode & 0o777, 0o640, "register changed profile permissions");

  json.dsh.profile.bundles.push(bundleName);
  writeJson(pkg, json);
  if (process.platform !== "win32") chmodSync(pkg, 0o600);
  assertSuccess(runBundle(pkg, "unregister"), "unregister");
  json = JSON.parse(readFileSync(pkg, "utf8"));
  assert.equal(json.dsh.profile.bundles.includes(bundleName), false);
  assert.equal(bundleName in json.dependencies, false);
  assert.equal(json.dependencies.keep, "1.0.0");
  if (process.platform !== "win32") assert.equal(statSync(pkg).mode & 0o777, 0o600, "unregister changed profile permissions");

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
  if (process.platform !== "win32") chmodSync(creds, 0o644);

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
  if (process.platform !== "win32") assert.equal(statSync(creds).mode & 0o777, 0o600, "credentials must be owner-only");

  const argvOnly = readFileSync(creds, "utf8");
  const rejectedArgv = runNode(credentialHelper, [creds, key], {
    env: { DSH_PROFILES: join(root, "profiles") },
  });
  assert.notEqual(rejectedArgv.status, 0, "key must not be accepted through argv");
  assert.equal(readFileSync(creds, "utf8"), argvOnly);
  assert.equal(output(rejectedArgv).includes(key), false);

  for (const source of [undefined, "", "\r\n# retained comment\r\n  # another comment"]) {
    rmSync(creds, { force: true });
    if (source !== undefined) writeFileSync(creds, source);
    const options = { input: `${key}\n`, env: { DSH_PROFILES: join(root, "profiles") } };
    assertSuccess(runNode(credentialHelper, [creds, "--check"], options), "empty-store preflight");
    assert.equal(existsSync(creds), source !== undefined, "preflight created a credentials file");
    if (source !== undefined) assert.equal(readFileSync(creds, "utf8"), source, "preflight modified credentials");
    const initialized = runNode(credentialHelper, [creds], options);
    assertSuccess(initialized, "empty-store initialization");
    assert.equal(output(initialized).includes(key), false);
    const text = readFileSync(creds, "utf8");
    assert.match(text, /^version: 1\r?$/m);
    assert.match(text, /^refs:\s*\r?$/m);
    assert.match(text, /DASHSCOPE_API_KEY: ["']?sk-credential-test_123456["']?/);
    if (source?.includes("# retained comment")) assert.match(text, /# retained comment/);
    if (process.platform !== "win32") assert.equal(statSync(creds).mode & 0o777, 0o600);
  }
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
    ["missing document version", "refs: {}\nrecords: {}\n", `${key1}\n`],
    ["unsupported document version", "version: 2\nrefs: {}\nrecords: {}\n", `${key1}\n`],
    ["string document version", 'version: "1"\nrefs: {}\nrecords: {}\n', `${key1}\n`],
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

