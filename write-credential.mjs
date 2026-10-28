/** Write only refs.DASHSCOPE_API_KEY; read the key from stdin, never argv. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const credsPath = process.argv[2];
const apiKey = fs.readFileSync(0, "utf8").trim();
const NAME = "DASHSCOPE_API_KEY";
if (!credsPath || !/^sk-[A-Za-z0-9_-]+$/.test(apiKey)) {
  console.error("需要凭据路径和有效的 sk- 密钥（从标准输入读取）。");
  process.exit(1);
}

let tmp;
try {
  let YAML;
  for (const candidate of [
    process.env.DSH_PROFILES && path.join(process.env.DSH_PROFILES, "noop.js"),
    path.join(path.dirname(credsPath), "noop.js"),
    import.meta.url,
  ].filter(Boolean)) {
    try { YAML = createRequire(candidate)("yaml"); break; } catch { /* Optional host parser. */ }
  }

  const raw = fs.existsSync(credsPath)
    ? fs.readFileSync(credsPath, "utf8").replace(/^\uFEFF/, "")
    : "version: 1\nrefs: {}\nrecords: {}\n";
  let out;
  if (YAML) {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length || !YAML.isMap(doc.contents)) throw new Error("invalid document");
    if (doc.contents.items.some((entry) => !["version", "refs", "records"].includes(String(entry.key)))) {
      throw new Error("unknown top-level key");
    }
    if (!doc.has("refs")) doc.set("refs", doc.createNode({}));
    if (!YAML.isMap(doc.get("refs", true))) throw new Error("refs must be a mapping");
    doc.setIn(["refs", NAME], apiKey);
    out = doc.toString();
    if (YAML.parse(out)?.refs?.[NAME] !== apiKey) throw new Error("credential validation failed");
  } else {
    // ponytail: preserve common block YAML; require the host YAML parser for complex refs.
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.replace(/\r\n?/g, "\n").split("\n");
    const topKeys = lines.filter((line) => /^[^\s#]/.test(line) && line.trim());
    if (topKeys.some((line) => !/^(version|refs|records):(?:\s|$)/.test(line))) throw new Error("unsupported document");
    for (const key of ["version", "refs", "records"]) {
      if (topKeys.filter((line) => line.startsWith(key + ":")).length > 1) throw new Error("duplicate key");
    }
    let start = lines.findIndex((line) => /^refs:/.test(line));
    if (start < 0) { start = lines.length; lines.push("refs:"); }
    if (!/^refs:\s*(?:\{\s*\}\s*)?(?:#.*)?$/.test(lines[start])) throw new Error("complex refs");
    lines[start] = lines[start].replace(/\{\s*\}/, "");
    let end = start + 1;
    while (end < lines.length && (!lines[end].trim() || /^\s|^#/.test(lines[end]))) end++;
    let indent;
    const names = new Set();
    let found = -1;
    for (let i = start + 1; i < end; i++) {
      if (!lines[i].trim() || /^\s*#/.test(lines[i])) continue;
      const match = lines[i].match(/^( +)([A-Za-z_][\w-]*):\s+(.+)$/);
      if (!match || (indent && indent !== match[1]) || names.has(match[2]) || /^[>|[\]{}&*!]/.test(match[3])) {
        throw new Error("complex or duplicate refs");
      }
      indent = match[1];
      names.add(match[2]);
      if (match[2] === NAME) found = i;
    }
    const entry = `${indent || "  "}${NAME}: ${JSON.stringify(apiKey)}`;
    if (found >= 0) lines[found] = entry;
    else lines.splice(end, 0, entry);
    out = lines.join(eol);
  }
  if (process.argv.includes("--check")) process.exit(0);
  tmp = `${credsPath}.bailian-${process.pid}.tmp`;
  fs.writeFileSync(tmp, out, { flag: "wx", mode: 0o600 });
  fs.renameSync(tmp, credsPath);
  console.log("credential updated");
} catch {
  // Parser errors can include source lines containing secrets; never print them.
  console.error("无法安全更新凭据：结构不受支持或文件不可写。原文件未被覆盖；请检查备份或使用 DSH 自带 YAML 解析器。");
  process.exitCode = 2;
} finally {
  if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
}
