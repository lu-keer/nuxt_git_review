# Git Hooks 实施与验收记录

验证日期：2026-11-15（Asia/Shanghai）。

## 已落地

- Husky 9：`core.hooksPath=.husky/_`，首次安装及依赖安装通过 `postinstall` 生成 Nuxt 配置、安装 hooks。
- lint-staged 17：暂存 Vue、JS、TS 文件执行 ESLint，不自动修复。
- pre-push：当前工作区全量 ESLint 和 Nuxt 类型检查。
- TypeScript 5.9：避免 TypeScript 7 与当前 Vue 工具链不兼容。
- Rolldown ~1.2.1：匹配 Nuxt peer 要求。
- Yarn 4.13.0、Node 22.21.0；Node 版本通过 `.nvmrc` 和 CI 固定。
- GitHub Actions：push / pull_request 执行不可变安装、检查、生产构建。
- 临时阻断探针已移除；正式 hooks 将执行时间和退出码写入 Git 本地目录的 `hook-checks.log`。

## 自动验证结果

| 场景 | 结果 |
| --- | --- |
| `yarn install --immutable` | 通过，锁文件无需变化 |
| `yarn check` | ESLint、Nuxt 类型检查通过 |
| `yarn build` | Node 22.21.0 下生产构建通过 |
| 隔离仓库首次提交 | 正式 pre-commit 执行并通过 |
| 未使用变量，文件名含空格 | ESLint 阻止提交，HEAD 不变 |
| 部分暂存 | 只检查暂存版本，成功后保留未暂存修改 |
| 删除文件、仅文档变更 | 无匹配任务，允许提交 |
| 工作区加入类型错误后推送 | 正式 pre-push 失败，本地 bare 远端无新增引用 |
| 清理类型错误后推送 | 推送到本地 bare 远端成功 |
| PATH 仅含系统目录 | 用户级 nvm 初始化后正式 pre-push 成功 |

Git 操作测试在独立临时仓库执行，使用项目配置、正式 hooks 与已安装依赖；测试远端是本机 bare 仓库。没有通过终端对本项目执行提交或 GitHub 推送。

Yarn 仍报告 Nuxt/ESLint 依赖内部的 peer 警告；项目直接依赖的 TypeScript、Rolldown 冲突已解决，实际检查和构建通过。

## 本机环境调整

已通过 nvm 安装 Node 22.21.0 并启用 Corepack。新增用户级 `~/.config/husky/init.sh`：加载 nvm，在仓库存在 `.nvmrc` 时选择指定版本。此配置属于本机，不会随仓库分发；其他开发者参照 README 配置。

## Codex GUI：待用户操作验证

自动化工具拒绝访问 Codex 自身，不能代点 Git 菜单。以上终端验证不等于 GUI 验证；从 Finder 重启的真实环境也尚未验收。

1. 在 Codex Git 界面暂存本次配置及项目文件，输入说明后点击“提交”。
2. 检查 `git rev-parse --git-path hook-checks.log` 指向的文件，应新增 `pre-commit started` 和 `pre-commit exit=0`；确认 HEAD 已产生。
3. 按 README 临时加入未使用变量并暂存，点击“提交”。应显示 ESLint 错误，日志退出码非零，HEAD 不变；随后恢复测试修改及暂存状态。
4. 首次提交后按 README 加入未提交的类型错误，点击“推送”。应新增 pre-push 失败日志，GitHub 远端引用不变；随后移除测试文件。
5. 干净工作区点击“推送”，应记录 `pre-push exit=0`，远端分支与 HEAD 一致；检查 GitHub Actions 实际运行结果。
6. 完全退出 Codex，从 Finder 重启后重复失败校验，确认 Node/Yarn 可见。

失败时保留错误输出及日志以定位；不要绕过 hooks。首次提交前 lint-staged 会提示无法创建备份，测试时保留原文件副本。

只有上述 GUI 操作和日志得到对应验证后，才能将 GUI 触发、真实远端推送和 CI 标记为已通过。
