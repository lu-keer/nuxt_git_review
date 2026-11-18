# Nuxt 本地审查推送门禁

## 环境与开发

使用项目 `packageManager` 指定的 Yarn 4.13.0，以及 `engines` 支持的 Node.js。

```sh
corepack enable
yarn install --immutable
yarn dev
yarn lint
yarn typecheck
yarn check
yarn build
yarn test:review-gate
```

项目使用 Husky 9。`prepare`/`postinstall` 会安装 Husky；安装后用 `git config --get core.hooksPath` 核对 `.husky/_`，并检查 `.husky/_/pre-push` 实际存在。仓库提供 `.husky/pre-push` 源文件；安装文件与 GUI 是否实际执行 hook 仍需验收。安装也会改变当前 checkout 的行为，未具备完整审查能力的宿主不要提前启用强制门禁。

本次没有新增 pre-commit 或独立 lint/typecheck hook。若项目已有其他推送检查，应保留并在凭证校验成功后执行，不覆盖已有脚本。

## 审查登记与推送

代码审查继续由当前 AI 宿主执行 `.agents/skills/code-review/SKILL.md`。hook 不调用 AI 或 Codex CLI，仅校验是否存在与实际推送完全匹配的完整审查登记。

1. 代码先提交到本地，保持工作区干净。
2. 在宿主明确请求“按推送登记流程审查”，指定命名 remote 和完整目标分支，例如 `origin`、`refs/heads/feat/example`。
3. 宿主执行 begin，使用返回的固定 baseOid 按现有 skill 运行六路审查，核查和报告后调用 complete，最后再清理 manifest。
4. complete 成功后，用户自行在原终端、编辑器或 Codex Git 界面推送到相同目标。

```sh
# 这只建立请求，不会启动审查；由宿主在审查前调用
node scripts/review-gate.mjs begin --remote origin --target refs/heads/feat/example

# 宿主按 skill 执行审查并生成结果 JSON 后调用
node scripts/review-gate.mjs complete --request <requestPath> --result <resultPath>

# 用户正常推送；首版目标分支必须已经存在
git push origin HEAD:refs/heads/feat/example
```

也可使用 `yarn review:gate begin ...` / `complete ...`。结果 JSON 契约见 skill 的“显式推送登记”章节与[技术方案](docs/local-review-receipt-pre-push-design.md)。不要把结果文件放进工作区导致 complete 的干净检查失败，应放在请求所在的 Git 元数据目录。

默认工作区审查和代码修改后的自动审查不登记 HEAD。六路缺失、失败、取消、输出无效或未知终态都不能登记。**仅检查完整执行，不按问题严重程度拦截**：即使存在 Critical/Major，也会展示计数并允许推送，由用户处理报告中的问题。

登记保存在 `git rev-parse --git-common-dir` 对应目录的 `review-gate/v1` 下，不提交 Git；linked worktree 共享存储。规则或提交范围不变时可复用；删除相应 completed JSON 可撤销。不自动清理、不设置时间 TTL。

## 首版范围和失效

- 仅支持当前分支向已有远端分支的单 ref 非空快进。拒绝新分支、删除、强推、标签、多 ref、detached HEAD 和浅克隆。
- remote 必须是命名 remote 且只有一个推送地址；不支持 URL 重写或自定义 receivepack。基线对象缺失时先显式 fetch，然后重新 begin。
- commit、amend、rebase、远端基线、目标分支、remote 地址或审查规则变化后需要重新审查登记。
- 审查前后必须干净；完成登记后未提交业务修改不属于推送对象，hook 仍只检查已登记 OID。
- 文档等排除文件按现有 skill 范围可登记 exempt，表示无需文本审查，不声称六路通过。非排除二进制变更不支持登记。
- 继续审查基线到 HEAD 的净差异，不逐一覆盖中间提交，不作为历史敏感信息扫描工具。
- 登记依赖遵循 skill 的主会话真实填写结果，不独立证明宿主执行。记录可被人为伪造，`--no-verify`、禁用 Husky 或不执行 hook 的客户端可以绕过。本方案防止日常漏审，不提供服务端强制保证。

## 故障与客户端验收

错误以 `[review-gate]` 开头，缺登记时在宿主重新发起显式推送审查；记录损坏则删除对应记录后重审。不要用“进程退出 0”或报告文件存在替代六路完成。真实宿主能力不足时审查未完成，不能用模拟任务生成正式登记。

GUI 不一定继承终端 PATH。确保 GUI hook 环境中的 Node 可用，不在仓库写个人路径。Node 不可见时 hook 失败，不能静默放行。

终端、团队实际编辑器和 Codex Git 界面分别在本地 bare remote 验收：缺登记阻止、有登记成功、新增提交后再次阻止，并核对远端 ref。终端通过不能证明 GUI 已覆盖。真实宿主、终端和 GUI 的实际验收状态见[验收记录](docs/review-gate-verification.md)。
