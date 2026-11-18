# Review gate 验收记录

日期：2026-11-18。实现状态：脚本和 hook 源文件已完成；真实六路成功验收未完成，当前 checkout 未运行 Husky 安装，尚未启用强制门禁。

## 已执行检查

| 命令或场景 | 实际结果 |
| --- | --- |
| `node --test scripts/review-gate.test.mjs` | 14 项全部通过；使用真实 Git、原 helper 和本地 bare remote，审查任务结果为测试模拟 |
| `node node_modules/eslint/bin/eslint.js scripts/review-gate.mjs scripts/review-gate.test.mjs --max-warnings=0` | 通过 |
| `yarn typecheck` | 通过 |
| `node --test .agents/skills/code-review/scripts/skill-structure.test.mjs .agents/skills/code-review/scripts/rule-batches.test.mjs` | 24 项全部通过 |
| `node --test .agents/skills/code-review/scripts/build-review-manifest.test.mjs` | 13 通过、7 失败：Windows 不支持测试中的换行/引号文件名，创建符号链接 EPERM，以及 POSIX mock 执行后 stdout 不可用；未修改 helper 或其测试 |
| `yarn lint` | 失败：既有 review-inputs.mjs、review-policy.mjs 的 no-control-regex，以及 app/hook-lint-probe.ts 的 unusedHookProbe；新增脚本定向 lint 通过 |
| `git diff --check` | 通过 |

测试包括缺登记阻止、完整登记放行、Critical/Major 放行、提交/规则/目标失效、CRLF、SHA-256、linked worktree、并行 complete、浅克隆、豁免/二进制和 `--no-verify` 绕过。实际远端 OID 由断言核验。

## 真实 skill 登记验收

隔离目录：`tmp/review-gate-acceptance`；仅本地 bare remote，未操作真实远端。审查材料为已提交的 greeting 文本变更，begin 和原 helper 已实际成功执行。

| 任务 | 实际状态 | 输出 | 宿主可用真实耗时 |
| --- | --- | --- | --- |
| Standards `/root/accept_standards` | completed | NO_FINDINGS | 不可用 |
| architect `/root/accept_architect` | completed | NO_FINDINGS | 不可用 |
| devops | 未启动 | 不适用 | 不可用 |
| product_contract | 未启动 | 不适用 | 不可用 |
| runtime_performance | 未启动 | 不适用 | 不可用 |
| security | 未启动 | 不适用 | 不可用 |

当前宿主原生委派控制入口在上述两路完成后不再可调用，无法继续启动剩余四路。不重试、不换模型、不以 CLI 或模拟任务补齐，未签发完成登记。真实结果以 completion incomplete 调用 complete，实际返回 4 / REVIEW_INCOMPLETE；verify 实际返回 1 / REVIEW_MISSING，completed 目录未生成。context.json、evidence.json 和原始材料均保留。

上述结果只验证真实不完整审查拒绝路径；**不能声称真实六路审查→登记→推送成功已通过**。未取得全部宿主停止核验控制能力，暂保留 manifest：`C:/Users/ADMINI~1/AppData/Local/Temp/code-review-GesZq0/manifest.json`。

## 客户端与启用状态

| 入口 | 状态 |
| --- | --- |
| 终端，模拟完整任务结果 | 真实 hook 缺登记阻止、有登记放行、新提交再阻止，已通过自动集成测试 |
| 终端，真实六路任务结果 | 未完成；已验证不完整任务拒绝登记 |
| 编辑器 Git 界面 | 未验证 |
| Codex Git 界面 | 未验证 |
| 当前项目强制 hook | 未安装；`.husky/pre-push` 源文件已提供，`.husky/_/pre-push` 不存在，未运行 yarn prepare |

项目 postinstall/prepare 将在后续安装时安装 Husky，操作者应先完成真实六路验收；源码交付不等于本 checkout 已启用。GUI 不可由终端结果替代，恢复原生委派能力并完成验收后再安装强制门禁。

实现后的自动代码审查见 [review-gate-code-review.md](review-gate-code-review.md)。
