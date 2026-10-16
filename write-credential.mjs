/**
 * 把 DASHSCOPE_API_KEY 结构化写入 DSH 凭据库 (.credentials.yaml)。
 *
 * 为什么需要这个脚本：凭据库是严格的 YAML 文档，含 `refs` 与 `records` 两个
 * 顶层段。天真的做法（把条目 append 到文件末尾）会把键落到 records 段之后，
 * 造成缩进错误 —— DSH 的严格解析器会直接拒绝整个文件，应用无法启动。
 * 因此这里必须做真正的结构化编辑。
 *
 * 优先使用 DSH 自带的 `yaml` 包做无损编辑（保留注释与其它条目）；
 * 若不可用，退化为「定位 refs 段 → 段内同缩进插入/替换」，绝不写到段外。
 *
 * 用法: node write-credential.mjs <credentials-path> <key>
 * 退出码: 0 成功 / 1 参数错误 / 2 无法安全解析
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [credsPath, apiKey] = process.argv.slice(2);
const NAME = "DASHSCOPE_API_KEY";

if (!credsPath || !apiKey) {
  console.error("用法: node write-credential.mjs <credentials-path> <key>");
  process.exit(1);
}

/** 在若干候选位置尝试解析出 `yaml` 包。 */
function loadYaml() {
  const candidates = [
    process.env.DSH_PROFILES ? path.join(process.env.DSH_PROFILES, "noop.js") : null,
    path.join(path.dirname(credsPath), "noop.js"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return createRequire(c)("yaml");
    } catch {
      /* 继续尝试下一个 */
    }
  }
  try {
    return createRequire(import.meta.url)("yaml");
  } catch {
    return null;
  }
}

const YAML = loadYaml();

if (YAML) {
  // ---- 结构化路径 ----
  const doc = fs.existsSync(credsPath)
    ? YAML.parseDocument(fs.readFileSync(credsPath, "utf8"))
    : YAML.parseDocument("version: 1\nrefs: {}\nrecords: {}\n");

  if (doc.errors?.length) {
    console.error(`凭据库解析失败: ${doc.errors[0].message}`);
    process.exit(2);
  }
  // 严格性自检：只允许 version / refs / records
  for (const key of doc.contents?.items?.map((i) => String(i.key)) ?? []) {
    if (!["version", "refs", "records"].includes(key)) {
      console.error(`凭据库含未知顶层键 ${JSON.stringify(key)}，拒绝修改以免破坏文件。`);
      process.exit(2);
    }
  }
  if (doc.get("refs") == null) doc.set("refs", doc.createNode({}));
  doc.setIn(["refs", NAME], apiKey);

  const out = doc.toString();
  fs.writeFileSync(credsPath, out, { mode: 0o600 });
  // 回读校验，确保写出的内容确实可解析且键在 refs 下
  const check = YAML.parse(fs.readFileSync(credsPath, "utf8"));
  if (check?.refs?.[NAME] !== apiKey) {
    console.error("回读校验失败：密钥未正确写入 refs 段。");
    process.exit(2);
  }
  console.log("mode=structured");
} else {
  // ---- 退化路径：段内行级编辑 ----
  // 注意：必须先剔除 CRLF 的 \r，否则 "refs:\r" 匹配不上 ^refs:$，
  // 会导致段落定位失败、条目被追加到文件末尾（破坏结构）。
  const raw = fs.existsSync(credsPath)
    ? fs.readFileSync(credsPath, "utf8")
    : "version: 1\nrefs:\nrecords: {}\n";
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  let refsIdx = lines.findIndex((l) => /^refs:\s*$/.test(l));
  if (refsIdx === -1) {
    const inline = lines.findIndex((l) => /^refs:\s*\{/.test(l));
    if (inline !== -1) {
      lines[inline] = "refs:";
      refsIdx = inline;
    } else {
      lines.push("refs:");
      refsIdx = lines.length - 1;
    }
  }
  // refs 段结束于下一个顶格（非缩进/非空/非注释）行
  let end = lines.length;
  for (let i = refsIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || /^\s/.test(l)) continue;
    end = i;
    break;
  }
  let indent = "  ";
  for (let i = refsIdx + 1; i < end; i++) {
    const m = lines[i].match(/^(\s+)\S/);
    if (m) {
      indent = m[1];
      break;
    }
  }
  let found = -1;
  for (let i = refsIdx + 1; i < end; i++) {
    if (lines[i].startsWith(`${indent}${NAME}:`)) {
      found = i;
      break;
    }
  }
  const entry = `${indent}${NAME}: ${apiKey}`;
  if (found !== -1) lines[found] = entry;
  else {
    // 跳过段尾的空白行，避免在 refs 与下一个顶层键之间制造空行
    let at = end;
    while (at > refsIdx + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, entry);
  }

  fs.writeFileSync(credsPath, lines.join(eol), { mode: 0o600 });
  console.log("mode=fallback");
}

try {
  fs.chmodSync(credsPath, 0o600);
} catch {
  /* Windows 等平台无 mode，忽略 */
}