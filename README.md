# 阿里云百炼模型插件 · DeepSeek Harness（Windows / macOS）

v1.0.3 提供 Windows 和 Mac 安装器，使用相同的 **14 个模型配置**，其中 **7 个声明支持图片输入**。零 npm 运行依赖。

## 快速入口

| 平台 | 安装入口 | 使用说明与测试报告 |
|---|---|---|
| Windows | 完整解压后双击 `install.bat` | [下方 Windows 安装说明](#安装与升级) · [Windows 测试报告](TEST-REPORT.txt) |
| Mac | 完整解压后双击 `install.command`，或终端运行 `./install.sh` | [Mac 安装说明](README-macos.md) · [Mac 测试报告](TEST-REPORT-macos.txt) |

两个版本都由接收者输入自己的百炼 API Key。下文保留 Windows 版使用说明；Mac 的命令、Node 自动发现与 Cmd+Q 重启步骤见 [Mac 安装说明](README-macos.md)。

## Windows 版

Windows 安装包 v1.0.3，基于用户提供的 v1.0.2 更新。提供 DeepSeek / Qwen / GLM / Kimi / MiniMax 的 **14 个模型配置**，其中 **7 个声明支持图片输入**。零 npm 运行依赖。

## 安装与升级

1. 先安装、启动过一次 DeepSeek Harness，再完全退出它（包括托盘进程）。
2. 把发行版 ZIP **完整解压**，进入 `dsh-plugin-bailian` 文件夹。
3. 双击 `install.bat`，粘贴**你自己的**阿里云百炼 API Key。输入不回显；已有凭据时直接回车即可保留。
4. 重新打开 Harness，在模型选择器中选择「阿里云百炼 (DashScope)」。

升级也运行同一个脚本。安装器会备份原插件文件、profile 配置和已有凭据。无需管理员权限；优先使用系统 Node，也可定位 Harness 在 Windows 卸载注册表中登记的自带运行时。

安装后默认模型为 `dashscope / deepseek-v4.1-flash`。profile 自己的 `cordis.patch.yml` 优先级更高，已有默认模型覆盖配置会继续生效。安装器不会修改该文件。

本包使用**中国内地（北京）**端点：
`https://dashscope.aliyuncs.com/compatible-mode/v1`。请使用该地域可用的百炼 Key；国际站等其他地域需要相应的端点配置。模型权限、配额与费用由你的百炼账号决定。

## 这次更新解决什么

- 保留 v1.0.2 的图片输入声明，避免支持图片的模型因缺少 `input` 而被 Harness 拦截。
- 按官方文档补齐 MiniMax M3 图片输入、修正 Kimi 长度参数；GLM-5.3 使用上游默认思考，避免未选档位时被旧适配器错误关闭思考。
- 兼容 Windows PowerShell 5.1，使用独立脚本修改 JSON，避免命令行引号问题。
- 凭据通过标准输入传给辅助进程，不出现在该进程参数中；解析失败时保留原文件。
- 对复杂或重复的 YAML 凭据结构采取保守处理：有可用的 `yaml` 模块时结构化编辑，否则拒绝不支持的格式。
- 预览模式零写入；安装前检查 profile；失败自动恢复配置、凭据和旧插件。
- 重复安装不会重复注册 bundle，安装目录包含完整脚本，便于重跑和卸载。

## 模型目录

以下为**插件配置值**，保留上传包的 14 个模型 ID，并按 2026-10-28 的百炼官方文档修正已发现的能力和长度差异；不是对每个账号的可用性保证，也不代表本次做过极限长度实测。

| 模型 ID | 上下文 / 最大输出 | 推理档位 | 图片输入 |
|---|---|---|---|
| `deepseek-v4-pro` | 1,000,000 / 384,000 | off / high / max | — |
| `deepseek-v4-pro-0813` | 1,000,000 / 384,000 | off / high / max | — |
| `deepseek-v4-flash-0731` | 1,000,000 / 384,000 | off / high / max | — |
| `deepseek-v4.1-flash` | 1,000,000 / 384,000 | off / high / max | 是 |
| `qwen3.8-max` | 1,000,000 / 131,072 | off / low / medium / xhigh | 是 |
| `qwen3.8-max-0902` | 1,000,000 / 131,072 | off / low / medium / xhigh | 是 |
| `qwen3.7-max` | 1,000,000 / 131,072 | 上游默认 | — |
| `qwen3.7-plus` | 1,000,000 / 65,536 | 上游默认 | 是 |
| `glm-5.2` | 1,000,000 / 131,072 | off / high / max | — |
| `glm-5.3` | 1,000,000 / 131,072 | 上游默认（始终思考） | — |
| `kimi-k2.6` | 262,144 / 16,384 | 上游默认 | 是 |
| `kimi-k3` | 1,048,576 / 1,048,576 | off / high / max | 是 |
| `MiniMax-M2.5` | 196,608 / 32,768 | 上游默认 | — |
| `MiniMax/MiniMax-M3` | 1,048,576 / 65,536* | 上游默认 | 是 |

*MiniMax M3 官方页面未给出最大输出长度，65,536 是本插件保留的输出配置上限。修正依据：[Kimi K2.6](https://help.aliyun.com/zh/model-studio/kimi-k2-6)、[Kimi K3](https://help.aliyun.com/zh/model-studio/kimi-k3)、[MiniMax M3](https://help.aliyun.com/zh/model-studio/minimax-m3)、[GLM 思考模式](https://www.alibabacloud.com/help/en/model-studio/glm)。

`input: [text, image]` 只声明客户端可发送图片；收到图片后还需上游模型和账号支持。上传包附带过往识图说明，本次发行测试不把它当作重新完成的在线实测。

## API Key

在[百炼控制台](https://bailian.console.aliyun.com/)创建自己的 Key。安装器按顺序读取：

1. `-ApiKey` 参数（兼容保留；会留在调用命令中，推荐交互输入）。
2. `DASHSCOPE_API_KEY` 环境变量。
3. 同目录可选的 `dashscope.key` 文件。
4. 交互输入；留空则保留已有凭据。

新 Key 默认请求一次模型列表接口做认证校验。这不验证逐个模型的权限或能力；网络不可达会提示并允许保存，401/403 则在写入前中止。可用 `-SkipVerify` 跳过联网校验。

只更新 `DSH_HOME/.credentials.yaml` 中的 `refs.DASHSCOPE_API_KEY`。未设置 `DSH_HOME` 时默认为 `%USERPROFILE%\.dsh`。

包内不含真实 Key。**不要分享** `.credentials.yaml`、`dashscope.key` 或 `.bailian-backup-*`：备份中也可能含有你其他服务的凭据。

## 常用命令

在解压目录打开 PowerShell：

```powershell
# 安装或升级
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 预览（包括卸载预览），不写文件、不联网
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall -DryRun

# 卸载本插件，保留凭据和其他插件
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall

# 非交互升级，已有凭据保持不变
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -NonInteractive

# 其他 profile
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile web
```

`install.bat` 使用本次进程的执行策略参数，不修改系统执行策略。所需 Node 版本为 18+；Harness 自身的版本要求仍以官方为准。

找不到运行时时，可手动指定自定义安装位置：

```powershell
$env:DSH_NODE = 'D:\program files\deepseek\resources\runtime\primary-runtime\dependencies\node\node.exe'
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

## 备份与回滚

每次实际安装/卸载生成 `<profile>/.bailian-backup-<时间戳>-<随机后缀>`，包含：

- `package.json.bak`、`cordis.patch.yml.bak`；
- 本次更换 Key 且原来有凭据时的 `credentials.yaml.bak`；
- 原来装过本插件时的 `plugin/` 完整旧目录。

发生安装错误会自动回滚。手工回滚需完全退出 Harness，恢复 `package.json.bak` 到 profile 的 `package.json`，并将 `plugin/` 内容恢复到 `node_modules/dsh-plugin-bailian/`。只有想撤回 Key 修改时才恢复凭据备份；先保留当前凭据副本，以免覆盖之后新增的其他服务凭据。

## 测试与兼容性

在源码目录运行：

```powershell
npm test
```

使用 Node 内置测试，不安装依赖。Windows 上会启动实际的 Windows PowerShell 5.1，在临时 `DSH_HOME` 测试安装、重复安装、升级、卸载、预览和失败保护；所有凭据均为假值。发行包的实测环境和结果见 `TEST-REPORT.txt`。

本次不发起收费模型推理请求；真实账号下的文本对话、图片识别、工具调用及推理档位仍需使用者验证。预发布 Harness 后续升级可能改变配置格式。

## 故障排查

- **模型没出现**：完全退出 Harness 后重开，确认正确 profile 的 `dsh.profile.bundles` 包含 `dsh-plugin-bailian`。
- **MISSING_CREDENTIAL**：重跑安装器输入 Key；避免把凭据文件内容截图发给他人。
- **凭据结构不受支持**：原文件不会被覆盖。保持原文件，使用 Harness 自带 YAML 解析器或先在其凭据管理中配置 Key；已有 Key 可用 `-NonInteractive` 只升级插件。
- **图片被拒绝**：选择表中声明图片输入的模型；若上游仍拒绝，检查账号权限和模型能力。
- **401/403 / product is not activated**：核对 Key 所属地域、权限、配额和模型开通状态。

## 分享方式

直接转发发行版 `dsh-plugin-bailian-v1.0.3.zip` 即可，让对方完整解压、双击安装并输入自己的 Key。ZIP 内含安装脚本、说明、许可证和测试报告。

若仓库设为私有，GitHub Release 链接需要相应访问权限；转发不含 Key 的 ZIP 不要求接收方有 GitHub 账号。

许可证：[MIT](LICENSE)。更新记录见 [CHANGELOG.md](CHANGELOG.md)。
