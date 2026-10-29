# 更新记录

## 1.0.3 Mac — 2026-10-29

- 同步 [Windows v1.0.3（`11b9d9b`）](https://github.com/luoyouyu520/dsh-plugin-bailian/commit/11b9d9be15b0967d9aaf54bf217da93c1b1ae7a6) 的 14 个模型配置：7 个声明支持图片输入，Flash 使用 `deepseek-v4-flash-0731`，修正 Kimi/MiniMax 长度参数，GLM-5.3 使用上游默认思考。
- 更新 `install.sh`，兼容 macOS 自带 Bash 3.2；添加可双击的 `install.command`，自动发现 Harness 自带 Node 18+，支持 `DSH_NODE` 手动指定。
- 支持环境变量、可选本地 Key 文件及隐藏交互输入；发行包不包含真实 Key。
- 同步独立 bundle 注册和凭据辅助脚本，密钥通过 stdin 传递，凭据校验后原子写入。
- 安装前检查包与 profile；预览零写入、不联网；升级备份旧插件；失败恢复配置、凭据和插件；支持从安装目录重跑或卸载。
- 增加 profile 安装锁，凭据权限为 `600`、备份目录权限为 `700`；保留已有用户 patch 和其他插件配置。
- 添加隔离 Mac 安装器测试；环境和结果单独记录在 `TEST-REPORT.txt`。

## 1.0.3 Windows — 2026-10-28（上游）

- 合入 1.0.2 模型目录，补齐 MiniMax M3 图片输入（共 7 个），修正 Kimi 长度参数和 GLM-5.3 思考设置。
- 修复 Windows PowerShell 5.1 注册引号问题；安装前验证 profile，密钥经 stdin 传递，凭据安全编辑和原子替换。
- 修复卸载预览；备份旧插件；失败自动回滚；支持安装目录重跑及自定义 Windows 安装位置的 Node。

## 1.0.2 — 上游上传包，2026-10-28

- 添加模型 `input` 模态声明，其中 6 个声明支持图片输入。

## 1.0.1 — 上游上传包中的历史更新

- 使用 `deepseek-v4-flash-0731` 模型 ID。
- 独立 `bundle-register.mjs` 避免 PowerShell 5.1 原生命令引号问题。
- 安装时由接收者填写自己的 API Key。

## 1.0.0

- 原仓库初版。
