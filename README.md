# dsh-plugin-bailian（Windows 版）

把 **阿里云百炼 (DashScope)** 的全部模型打包成 DeepSeek Harness 插件，
在新电脑上一键安装即可使用，无需重新手工配置。

包含 **14 个模型**，涵盖 DeepSeek / Qwen / GLM / Kimi / MiniMax 五大系列。

---

## 一键安装

把整个 `dsh-plugin-bailian` 文件夹拷到 Windows 电脑，然后：

**方式 A（推荐）**：直接双击 `install.bat`

**方式 B（命令行）**：在文件夹里打开 PowerShell，运行

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

两者效果相同。`install.bat` 已自动带上绕过执行策略的参数，双击即可。

安装完成后 **完全退出 DSH（托盘图标右键 → Exit）再重新打开**，
在模型选择器中即可看到「阿里云百炼 (DashScope)」分组。

> **不需要安装 Node。** 安装脚本会自动复用 DSH Desktop 自带的 Node 运行时。
> API Key 已打包在 `dashscope.key` 里，无需手动输入。

---

## 包含的模型

| 系列 | 模型 ID | 上下文 | 最大输出 | 推理档位 |
|---|---|---|---|---|
| DeepSeek | `deepseek-v4-pro` | 1M | 384K | off / high / max |
| DeepSeek | `deepseek-v4-pro-0813` | 1M | 384K | off / high / max |
| DeepSeek | `deepseek-v4-flash` | 1M | 384K | off / high / max |
| DeepSeek | `deepseek-v4.1-flash` | 1M | 384K | off / high / max |
| Qwen | `qwen3.8-max` | 1M | 128K | off / low / medium / xhigh |
| Qwen | `qwen3.8-max-0902` | 1M | 128K | off / low / medium / xhigh |
| Qwen | `qwen3.7-max` | 1M | 128K | — |
| Qwen | `qwen3.7-plus` | 1M | 64K | — |
| GLM | `glm-5.2` | 1M | 128K | off / high / max |
| GLM | `glm-5.3` | 1M | 128K | off / low / high / max |
| Kimi | `kimi-k2.6` | 256K | 256K | — |
| Kimi | `kimi-k3` | 256K | 256K | off / high / max |
| MiniMax | `MiniMax-M2.5` | 192K | 32K | — |
| MiniMax | `MiniMax/MiniMax-M3` | 256K | 64K | — |

默认模型设置为 `deepseek-v4.1-flash`。

---

## 文件说明

| 文件 | 作用 |
|---|---|
| `cordis.patch.yml` | **核心**：provider 路由 + 14 个模型目录 |
| `package.json` | 声明本包为 DSH bundle |
| `install.bat` | 双击即可安装（自动绕过执行策略） |
| `install.ps1` | 安装/卸载主脚本 |
| `write-credential.mjs` | 安全写入凭据库的辅助脚本 |
| `dashscope.key` | 你的 API Key（安装脚本读取它） |

---

## 常用命令

```powershell
# 安装（默认 desktop profile）
powershell -ExecutionPolicy Bypass -File install.ps1

# 只预览，不落盘
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun

# 卸载（保留 API Key）
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall

# 指定其它 profile
powershell -ExecutionPolicy Bypass -File install.ps1 -Profile web

# 覆盖 API Key
powershell -ExecutionPolicy Bypass -File install.ps1 -ApiKey "sk-xxx"
```

---

## 安装脚本做了什么

1. **备份** `package.json` / `cordis.patch.yml` / `.credentials.yaml`
   到 `.bailian-backup-<时间戳>\`
2. 把插件包复制到 `<profile>\node_modules\dsh-plugin-bailian`
3. 把 API Key 写入 `%USERPROFILE%\.dsh\.credentials.yaml` 的
   `refs.DASHSCOPE_API_KEY`（**结构化写入，会回读校验**）
4. 在 `<profile>\package.json` 的 `dsh.profile.bundles` 末尾追加
   `dsh-plugin-bailian`，并在 `dependencies` 登记本地依赖
5. 校验插件文件完整落盘

脚本**幂等**：重复运行不会产生重复条目，API Key 会原地更新。

---

## 故障排查

**`无法加载文件，因为在此系统上禁止运行脚本`**

PowerShell 执行策略限制。用 `install.bat` 双击，或加参数：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

**`找不到可用的 Node 运行时`**

脚本没自动定位到 DSH 自带运行时。手动指定：

```powershell
$env:DSH_NODE="C:\Users\你\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\node.exe"
powershell -ExecutionPolicy Bypass -File install.ps1
```

**模型没有出现**

1. 确认已**完全退出** DSH（`Ctrl+Shift+Esc` 打开任务管理器，
   结束所有 `DeepSeek Harness` 进程），而不只是关窗口
2. 检查 bundle 是否注册成功：
   ```powershell
   Get-Content "$env:USERPROFILE\.dsh\profiles\desktop\package.json"
   ```
   `dsh.profile.bundles` 里应有 `dsh-plugin-bailian`

**报错 `MISSING_CREDENTIAL`**

凭据没写进去。检查：

```powershell
Select-String DASHSCOPE "$env:USERPROFILE\.dsh\.credentials.yaml"
```

应有 `refs.DASHSCOPE_API_KEY: sk-...`。若缺失，重新运行安装脚本。

**报错 `cannot resolve profile bundle`**

插件不在 DSH 的解析路径上。DSH 从 profile 目录和 profile 的 `node_modules`
解析 bundle 名 —— **不能**放在 `plugins\` 下。重新运行安装脚本即可。

---

## 回滚

安装脚本每次都会备份。回滚：

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\.bailian-backup-<时间戳>\package.json.bak" `
          "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Force
```

---

## 安全提示

`dashscope.key` 内含**明文 API Key**。请只通过可信渠道传输，
不要提交到 git 或发到公开群聊。

安装后密钥存放在 `%USERPROFILE%\.dsh\.credentials.yaml`。
若怀疑泄露，请到阿里云百炼控制台轮换密钥。
---

## 方式三：DSH 直接安装（git 安装规格，推荐）

本仓库可被 DeepSeek Harness 直接作为 bundle 安装，无需手动运行脚本：

1. 打开 DSH Web 侧边栏 → **插件** 页 → 安装外部组合包
2. 输入安装 spec：`github:luoyouyu520/dsh-plugin-bailian`
   （等价写法：`https://github.com/luoyouyu520/dsh-plugin-bailian`）
3. 安装完成后 bundle 自动启用；**完全退出 DSH 后重开**生效

> **私有仓库提示**：DSH 安装前的连通性预检不携带凭据，实际认证由 pnpm
> 调用的 git 完成——本机 git 需已存有 GitHub 凭据（Windows 凭据管理器；
> 任意一次成功的 git push/pull 即可写入）。
>
> **安装后仍需配置密钥**：把百炼 API Key 写入
> `~/.dsh/.credentials.yaml` 的 `refs.DASHSCOPE_API_KEY`。
> 运行本仓库的 `install.ps1` 可自动完成，或手工编辑该文件。
