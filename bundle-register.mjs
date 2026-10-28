/**
 * 注册 / 注销 DSH profile bundle —— 由 install.ps1 调用。
 *
 * 为什么单独做成一个文件，而不是 install.ps1 里的 `node -e "..."`：
 * Windows PowerShell 5.1 在把**含双引号**的字符串当参数传给原生 exe 时，
 * 会把内层引号吃掉（它不按 Windows 规则转义），于是 JS 到手时已经坏了：
 *
 *     j.dependencies[name] = "file:./node_modules/" + name;
 *     变成
 *     j.dependencies[name] = file:./node_modules/ + name;   // SyntaxError
 *
 * 结果是「注册 bundle 失败」、bundle 没进 dsh.profile.bundles、模型列表里
 * 看不到百炼。改成独立文件 + 环境变量传参，就完全绕开了引号问题。
 *
 * 用法:
 *   PKG_JSON=<profile>/package.json BUNDLE_NAME=dsh-plugin-bailian \
 *     node bundle-register.mjs register|unregister
 *
 * 退出码: 0 成功 / 1 参数或环境缺失 / 2 解析或写入失败
 */
import fs from "node:fs";
import path from "node:path";

const mode = String(process.argv[2] || "").trim();
const pkgPath = process.env.PKG_JSON;
const name = process.env.BUNDLE_NAME;

if (!["register", "unregister", "validate"].includes(mode) || !pkgPath || name !== "dsh-plugin-bailian") {
  console.error(
    "用法: PKG_JSON=<path> BUNDLE_NAME=<name> node bundle-register.mjs register|unregister",
  );
  process.exit(1);
}
if (!fs.existsSync(pkgPath)) {
  console.error(`找不到 ${pkgPath}`);
  process.exit(1);
}

let json;
try {
  json = JSON.parse(fs.readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
} catch (e) {
  console.error(`解析 package.json 失败: ${e.message}`);
  process.exit(2);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
if (!isObject(json) ||
    [json.dsh, json.dsh?.profile, json.dependencies].some((value) => value !== undefined && !isObject(value)) ||
    (json.dsh?.profile?.bundles !== undefined &&
     (!Array.isArray(json.dsh.profile.bundles) || !json.dsh.profile.bundles.every((value) => typeof value === "string")))) {
  console.error("package.json 的 dsh/profile/dependencies 必须是对象，bundles 必须是字符串数组。未修改文件。");
  process.exit(2);
}
if (mode === "validate") process.exit(0);

json.dsh = json.dsh || {};
json.dsh.profile = json.dsh.profile || {};
const bundles = (json.dsh.profile.bundles = json.dsh.profile.bundles || []);

if (mode === "register") {
  if (!bundles.includes(name)) bundles.push(name);
  json.dependencies = json.dependencies || {};
  // 同时登记为本地依赖，避免后续 pnpm 把它当作多余内容清理掉
  json.dependencies[name] = "file:./node_modules/" + name;
} else {
  json.dsh.profile.bundles = bundles.filter((x) => x !== name);
  if (json.dependencies && typeof json.dependencies === "object") delete json.dependencies[name];
}

// 先写临时文件再原子改名：中途失败也不会留下半个 package.json
const out = JSON.stringify(json, null, 2) + "\n";
const tmp = pkgPath + `.bailian-${process.pid}.tmp`;
try {
  fs.writeFileSync(tmp, out, { flag: "wx" });
  fs.renameSync(tmp, pkgPath);
} catch (e) {
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* 清理失败无所谓 */
  }
  console.error(`写入 ${path.basename(pkgPath)} 失败: ${e.message}`);
  process.exit(2);
}

console.log(`mode=${mode} bundles=${json.dsh.profile.bundles.length}`);
