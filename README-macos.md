# 阿里云百炼模型插件 · DeepSeek Harness（Mac 版）

Mac 安装包 **v1.0.3**，同步自 [Windows v1.0.3 更新（`11b9d9b`，2026-10-28）](https://github.com/luoyouyu520/dsh-plugin-bailian/commit/11b9d9be15b0967d9aaf54bf217da93c1b1ae7a6)。提供 DeepSeek / Qwen / GLM / Kimi / MiniMax 的 **14 个模型配置**，其中 **7 个声明支持图片输入**。零 npm 运行依赖。

## 安装与升级

1. 先安装、启动过一次 DeepSeek Harness，再用 **Cmd+Q 完全退出**应用。
2. 把 Mac 发行版 ZIP **完整解压**，进入 `dsh-plugin-bailian` 文件夹。
3. 双击 **`install.command`**，粘贴你自己的阿里云百炼 API Key。终端输入不回显；已有凭据时直接回车即可保留。
4. 重新打开 Harness，在模型选择器中选择「阿里云百炼 (DashScope)」。

也可以在终端进入解压目录后运行：

```bash
./install.sh
```

升级运行同一个脚本。安装器会备份原插件文件、profile 配置，以及本次需要修改的已有凭据；安装失败会自动回滚。无需管理员权限。安装器兼容 macOS 自带 **Bash 3.2**，需要 **Node 18+**：先尝试 `DSH_NODE` 指定路径，再尝试系统 Node，最后定位 `/Applications`、`~/Applications` 和 Spotlight 中 Harness 自带的运行时。

找不到 Node 时可手动指定：

```bash
DSH_NODE="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" ./install.sh
```

本插件默认模型为 `dashscope / deepseek-v4.1-flash`。profile 自己的 `cordis.patch.yml` 优先级更高，已有默认模型覆盖配置会继续生效；安装器保留该文件。

本包端点为 `https://dashscope.aliyuncs.com/compatible-mode/v1`，对应中国内地（北京）。请使用该地域可用的百炼 Key；其他地域需使用对应的端点。模型权限、配额和费用由百炼账号决定。

## 本次 Mac 更新

- 同步 Windows v1.0.3 的模型 ID、图片输入声明、Kimi 长度参数和 GLM-5.3 思考设置。
- 密钥通过标准输入传给辅助进程，避免出现在辅助进程的命令行参数中；凭据先校验再原子替换。
- 安装前检查源码包和 profile，预览零写入，升级备份旧插件，安装失败恢复配置、凭据和插件。
- 安装目录包含完整安装脚本，支持从该目录再次升级或卸载；重复安装不会重复注册 bundle。
- 使用 profile 安装锁防止同时运行两个安装器；凭据权限设为 `600`，备份目录权限为 `700`。

## 模型目录

以下为与 Windows v1.0.3 同步的**插件配置值**，不代表本次 Mac 更新已逐个完成在线推理或极限长度测试。

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

*MiniMax M3 的 65,536 为上游插件保留的输出配置上限。Windows 更新引用的修正依据：[Kimi K2.6](https://help.aliyun.com/zh/model-studio/kimi-k2-6)、[Kimi K3](https://help.aliyun.com/zh/model-studio/kimi-k3)、[MiniMax M3](https://help.aliyun.com/zh/model-studio/minimax-m3)、[GLM 思考模式](https://www.alibabacloud.com/help/en/model-studio/glm)。

`input: [text, image]` 声明 Harness 可以发送图片，实际可用性还需模型和账号支持。真实文本对话、图片识别、工具调用和推理档位需使用对应账号验证。

## API Key

在[百炼控制台](https://bailian.console.aliyun.com/)创建自己的 Key。安装器按以下顺序读取：

1. `DASHSCOPE_API_KEY` 环境变量。
2. 安装脚本同目录中可选的 `dashscope.key` 文件。
3. 终端交互输入（隐藏显示）；留空保留已有凭据。

`--non-interactive` 关闭交互提示；若环境变量和 Key 文件也为空，则只升级插件、保留现有凭据。卸载和预览均不读取或更新 Key。

新 Key 默认请求一次模型列表接口做认证校验，不验证逐个模型的权限或能力。网络不可达会提示并允许保存；401/403 会在写入前中止。`--skip-verify` 可跳过联网认证。

安装器只更新 `DSH_HOME/.credentials.yaml` 中的 `refs.DASHSCOPE_API_KEY`，默认 `DSH_HOME` 为 `~/.dsh`。有可用的 `yaml` 模块时进行结构化编辑；否则仅支持常见的简单 `refs` 映射，遇到复杂或重复结构会保留原文件并中止。

发行 ZIP 不包含真实 Key。本地已有的 `dashscope.key` 仍可继续使用；它不会复制到安装后的插件目录。**不要分享** `dashscope.key`、`.credentials.yaml` 或 `.bailian-backup-*`：备份可能还包含其他服务的凭据。

## 常用命令

```bash
./install.sh                         # 安装或升级
./install.sh --dry-run               # 预览安装，不写文件、不联网
./install.sh --uninstall --dry-run   # 预览卸载
./install.sh --uninstall             # 卸载插件，保留凭据
./install.sh --non-interactive       # 无交互安装或升级
./install.sh --skip-verify           # 跳过新 Key 的在线认证
DSH_PROFILE=web ./install.sh          # 指定其他 profile（默认 desktop）
DSH_HOME=/path/to/.dsh ./install.sh   # 指定 DSH 数据目录
```

每次安装后都需 **Cmd+Q 完全退出 Harness 再重新打开**。

## 备份与回滚

每次实际安装或卸载生成 `<profile>/.bailian-backup-<时间戳>-<随机后缀>`，包含：

- `package.json.bak`、`cordis.patch.yml.bak`；
- 本次更换 Key 且原来有凭据时的 `credentials.yaml.bak`；
- 原来装过本插件时的 `plugin/` 完整旧目录。

发生安装错误会自动回滚。手工回滚时先完全退出 Harness，将 `package.json.bak` 恢复为 profile 的 `package.json`，并用备份中的 `plugin/` 完整替换 `node_modules/dsh-plugin-bailian/`。若该次安装前未装过本插件，恢复 profile 后移除新插件目录即可。

仅在需要撤回 Key 修改时恢复凭据备份，并重新执行 `chmod 600 ~/.dsh/.credentials.yaml`；恢复前保留当前凭据副本，避免覆盖之后新增的其他服务凭据。

## 测试与兼容性

源码包包含 Node 内置测试，不需要安装 npm 依赖：

```bash
npm test
```

没有系统 Node/npm 时，可直接使用 Harness 自带 Node：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" --test tests/*.test.mjs
```

测试使用 `/bin/bash`、临时 `DSH_HOME` 和假 Key，检查安装、升级、安装目录重跑、卸载、预览、回滚、并发保护、凭据和模型配置。测试不会操作实际 profile 或发起收费模型推理。实测环境与结果见 [Mac 测试报告](TEST-REPORT-macos.txt)；Harness 后续升级可能改变配置格式。

## 故障排查

- **脚本无法执行**：在解压目录执行 `chmod +x install.sh install.command`，再运行 `./install.sh`。
- **模型没出现**：Cmd+Q 后重开；确认所用 profile 的 `dsh.profile.bundles` 包含 `dsh-plugin-bailian`，插件位于该 profile 的 `node_modules/dsh-plugin-bailian`。
- **MISSING_CREDENTIAL**：重跑安装器输入 Key；避免把凭据文件内容截图发给他人。
- **凭据结构不受支持**：保留原文件，使用 Harness 的凭据管理配置 Key，或在宿主可用的 `yaml` 模块下重跑；已有 Key 时可用 `--non-interactive` 仅升级插件。
- **Another installer**：等待另一个安装器退出。若上次被强制终止，先核对 `<profile>/.bailian-install.lock/pid` 中的进程已退出，再移除这个锁目录并重试。
- **图片被拒绝**：选择表中支持图片的模型，检查上游模型能力和账号权限。
- **401/403 / product is not activated**：核对 Key 所属地域、权限、配额和模型开通状态。

## 分享方式

转发不含 Key 的 Mac 发行 ZIP，让接收者完整解压、双击 `install.command` 并输入自己的 Key。不要直接压缩已安装的 profile 或含私人 Key 的工作目录。若仓库设为私有，GitHub 链接需要相应访问权限；单独转发 ZIP 不要求接收者有 GitHub 账号。

许可证：[MIT](LICENSE)。更新记录见 [CHANGELOG.md](CHANGELOG.md)。
