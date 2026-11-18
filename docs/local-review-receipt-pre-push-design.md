# 复用 code-review skill 的 Git 推送前审查登记校验方案

状态：待实现。本文中的脚本、命令和登记功能均为设计，不代表已经存在。

日期：2026-11-18。本版替代此前的完整审查执行器方案。

## 1. 目标与边界

继续由当前 AI 宿主执行现有 `.agents/skills/code-review/SKILL.md`。只增加两件事：审查完整结束后登记审查范围；Git `pre-push` 检查实际推送范围是否有对应登记。

hook 不执行 AI，不调用 Codex CLI，不新建审查执行器，不重新实现六路调度。现有 skill 的 Standards、五条 AI 规则、模型继承、容量调度、预算、核查和报告格式保持不变。

本版只检查“是否完整执行过代码审查”，不按 Critical、Major、Minor 阻止推送。有 findings 但审查完整结束，也允许登记和推送；审查报告仍明确展示问题。任一必要任务未完成、输出无效或状态未知，不能登记为完成。未来若要按问题严重程度阻止推送，应另行修改策略，不在本版混入。

适用终端、编辑器和 Codex Git 界面，前提是其调用的 Git 执行本地 hook。登记是本机流程记录，可以被人为伪造；hook 也可以被 `--no-verify`、禁用 Husky 或修改 Git 配置绕过。本版用于防止日常漏审，不提供不可绕过的远端安全保证。

## 2. 最小实现范围

| 文件                                    | 操作    | 职责                                      | 预估规模         |
| ------------------------------------- | ----- | --------------------------------------- | ------------ |
| `scripts/review-gate.mjs`             | 新增    | begin/complete/verify 命令、审查范围登记、hook 校验 | 220～350 行脚本  |
| `scripts/review-gate.test.mjs`        | 新增    | 临时 Git 仓库测试登记、失效和推送阻断                   | 180～280 行测试  |
| `.husky/pre-push`                     | 新增或合并 | 调用 verify，保留已有检查                        | 5～15 行 shell |
| `.agents/skills/code-review/SKILL.md` | 修改    | 增加显式推送审查的前后登记步骤                         | 约 30～50 行说明  |
| `package.json`                        | 修改    | 增加脚本入口和测试命令                             | 约 5～10 行配置   |
| `README.md`                           | 修改    | 安装、使用、限制和客户端验收说明                        | 约 40～70 行文档  |

预计新增 3 个文件，修改 3 个文件，脚本及测试约 400～630 行；不新增运行依赖，不修改 lockfile。使用 Node 内置 fs、crypto、child_process、path、test、assert。

如果真实 hook 已存在，合并而非覆盖；若目录缺失，则创建项目级 Husky hook。README 描述不作为实际 hook 存在的依据。

不新增宿主适配器、JSON Schema 文件、签名、数据库、通用凭证框架、并发任务调度器、自动清理器或服务端接口。现有 manifest helper 和六份规则不修改。

## 3. 首版支持范围

为直接复用现有 helper，采用以下限制：

- 审查前代码已提交，工作区干净，包含未跟踪文件检查；ignored 文件不计入干净状态。
- 仅支持当前检出的本地分支，且审查终点为固定 HEAD。
- 仅支持已有远端分支的普通快进更新；远端旧提交必须在本地存在且是 HEAD 的祖先。
- 每次只允许一个实际 ref 更新；没有更新行时直接成功。
- 只支持一个命名 remote，其只有一个可确定的 push URL；任意 URL remote、多 push URL、URL 重写和自定义 receivepack 配置均明确拒绝。
- 新分支、删除分支、多 ref、强推或回退、标签、detached HEAD、浅克隆均拒绝，并给出明确提示。
- OID 长度依据仓库对象格式识别，兼容 SHA-1/SHA-256，不写死 40 位。

这些限制由 begin 和 verify 共用的校验函数执行。不能在缺登记时退化为“当前 HEAD 曾审查过”或自动猜测 merge-base。

现有 skill 审查基线到 HEAD 的净差异，不覆盖已被后续提交抵消的中间历史；因此本方案不宣称每个上传历史提交都逐一审查，也不作为历史敏感信息扫描工具。若未来需要该能力，应单独扩展审查材料，而不是在 hook 中偷偷改变现有 skill 语义。

## 4. 用户流程与命令接口

以下命令为拟新增接口：

```sh
# 先在本地完成提交并保持工作区干净
# 在 AI 宿主明确请求：按推送登记流程审查 origin 的目标分支

# 由宿主在审查开始前执行；不是启动 AI 的命令
node scripts/review-gate.mjs begin --remote origin --target refs/heads/feat/example

# begin 输出 request 文件绝对路径、固定 baseOid 和 headOid
# 宿主随后按现有 skill 执行：
node <skill绝对路径>/scripts/build-review-manifest.mjs --base <baseOid>

# skill 全部必要任务完成并按现有格式报告后，由宿主登记
node scripts/review-gate.mjs complete --request <request文件绝对路径> --result <结果JSON绝对路径>

# 用户在原终端或 Git 界面正常推送
# 推送的目标分支必须与 begin 一致
git push origin HEAD:refs/heads/feat/example
```

`package.json` 增加 `review:gate` 和 `test:review-gate`，分别映射到脚本及 `node --test scripts/review-gate.test.mjs`；可使用 `yarn review:gate begin ...` 等等价命令。

hook 仅运行：

```sh
node scripts/review-gate.mjs verify "$@"
```

实际 hook 必须检查上条命令退出码并在失败时立即退出；之后继续执行已有 lint/typecheck 等检查。verify 不读取用户终端输入，只读取 Git 传入的 stdin。Node 缺失必须失败，不通过调用 yarn 或交互 shell 临时修复。

## 5. begin：固定审查范围

按以下顺序执行：

1. 解析命名 remote、唯一 push URL、目标完整 branch ref，以及当前本地 branch ref。
2. 检查工作区干净、非浅克隆、当前分支及参数符合支持范围。
3. 使用 `git ls-remote --refs` 对唯一 push URL 查询目标 ref 的实际 OID，不使用可能过时的远端跟踪分支。
4. 记录 baseOid；通过 Git 验证其对象本地存在、为 commit 且是 HEAD 的祖先。不存在时提示用户显式 fetch 后重试，不自动 fetch。
5. 固定 headOid；baseOid 与 headOid 相同时提示无需审查，不建立完成登记。
6. 计算当前规则指纹，并生成 requestId，原子写入 request 文件。
7. 输出请求绝对路径及固定 baseOid/headOid，供宿主调用 skill。

Git 调用使用参数数组，禁止拼接 shell 命令；禁用 replace refs，并拒绝会改变历史解释的本地 grafts。目标 URL 仅计算摘要，不写入报告或日志；错误提示不回显可能包含凭据的地址。

prepare 期间的远端查询无法保证之后不变；最终由 pre-push 的实际 remoteOid 比对，变化就拒绝并重新 begin。

## 6. 现有 skill 的最小接入

### 6.1 何时登记

只在用户明确请求“推送登记审查”，并提供 remote/目标分支时运行 begin。日常代码修改后自动触发的工作区审查照常执行，不隐式登记 HEAD，也不改变 AGENTS.md 的自动审查范围。

新增的登记步骤是 skill 的可选前后处理，不增加第二次审查：

1. 显式推送审查：先 begin，再读取返回的固定基线。
2. 用现有 helper 的 `--base <baseOid>` 构建 manifest，核对 repositoryRoot、baseCommit，以及当前 HEAD 等于请求 headOid。
3. 按现有 skill 执行全部审查、候选核查和报告，不修改代码。
4. 主会话输出最小结果 JSON，调用 complete。只有全部必要任务完成且有效，才登记完成。
5. complete 拒绝或 skill 未完成时如实报告，不自动重试，不自动推送。

现有 skill 原生委派不可用或六路未完成时，仍按原规则报告未完成。登记功能不会解决此前 CLI 的宿主能力问题，也不会换成单模型审查兜底。

### 6.2 最小结果 JSON

下例只展示任务结构；正式 reviewed 结果必须包含全部六个独立任务：

```json
{
  "requestId": "<uuid>",
  "manifestPath": "<本次manifest绝对路径>",
  "manifestBaseOid": "<full-oid>",
  "completion": "completed",
  "coverage": "reviewed",
  "tasks": [
    {
      "ruleId": "standards",
      "taskId": "<host-task-id>",
      "status": "completed",
      "outputValid": true
    }
  ],
  "verificationTasks": [],
  "findings": { "critical": 0, "major": 1, "minor": 0 }
}
```

首轮任务键必须恰好为 standards、architect、devops、product_contract、runtime_performance、security，taskId 唯一且非空。Summary 不是任务。激活的核实任务必须单独列出，带前置 taskId，且全部完成有效；核实成功不能覆盖首轮失败。

complete 校验字段、任务集合和状态，不独立向宿主查询任务真实性。这里信任遵循现有 skill 的主会话登记真实结果，明确区别于可信宿主证明。

### 6.3 排除项和空材料

继续采用现有 skill 的 ignored、文档和 `*.test.mjs` 排除规则。

若 helper 的 textFileCount 为 0：

- 没有非排除二进制变更时，coverage 为 `exempt`，tasks/verificationTasks 为空，记录 `no_reviewable_text`；这是“按现有范围无需审查”，不写“六路通过”。
- 存在非排除二进制变更时，不登记完成，提示现有文本审查无法覆盖该材料。

混合文本和二进制变更也拒绝登记，避免用文本任务完成状态覆盖未审查二进制。规则正文或 standardSources 被作为审查依据时，不因为其是 Markdown 就忽略其规则指纹。

## 7. 存储与登记结构

使用 `git rev-parse --git-common-dir` 解析公共 Git 目录，支持 linked worktree，不能假设 `.git` 一定是目录。

```text
<git-common-dir>/review-gate/v1/
  requests/<requestId>.json
  completed/<scopeKey>.json
```

无全局配置、无外部存储，不新增仓库 UUID。记录只在对应 Git 公共目录查找；新 clone 不带登记。linked worktree 共享存储，但当前分支、HEAD、remote 和指纹仍须匹配。

request 字段：version、requestId、remoteName、pushUrlHash、localRef、remoteRef、baseOid、headOid、rulesHash、startedAt。

完成登记示例：

```json
{
  "version": 1,
  "requestId": "<uuid>",
  "remoteName": "origin",
  "pushUrlHash": "<sha256>",
  "localRef": "refs/heads/feat/example",
  "remoteRef": "refs/heads/feat/example",
  "baseOid": "<full-oid>",
  "headOid": "<full-oid>",
  "rulesHash": "<sha256>",
  "coverage": "reviewed",
  "completion": "completed",
  "tasks": [],
  "verificationTasks": [],
  "findings": { "critical": 0, "major": 1, "minor": 0 },
  "completedAt": "2026-11-18T00:00:00Z"
}
```

正式 reviewed 登记的 tasks 必须满足前述六路约束，不能使用示例中的空数组。

`scopeKey` 为固定字段顺序数组 `[version, remoteName, pushUrlHash, localRef, remoteRef, baseOid, headOid, rulesHash]` 的 JSON UTF-8 字节 SHA-256。直接构造数组，避免引入通用 JSON 规范化库；读取时重新计算并与文件名及字段匹配。

`rulesHash` 对排序后的资源路径及各文件原始字节摘要计算哈希，包含：SKILL.md、references 下全部规则/规范 Markdown、scripts 下生产 `.mjs`（排除 `.test.mjs`）、仓库全部受 Git 跟踪的 AGENTS.md，以及 review-gate.mjs 本身。每项编码为 `[规范相对路径, 字节摘要]`，构造排序数组再哈希。缺失必要资源直接失败，不当成空内容。

这是略保守的指纹：无关规范文件变化也可能要求重审，首版接受该代价以避免复杂依赖分析。其他用户级宿主指令不纳入，属于已知限制。忽略规则通过工作区干净约束保持仓库内版本一致；个人 ignored 配置不构成防篡改保证。

不设置时间 TTL。规则和提交范围不变时可重复推送；时间只用于展示。删除对应 completed 文件即撤销登记。

## 8. complete：检查并写入

complete 按以下顺序执行：

1. 校验 request/result 文件结构、大小和 requestId。request 必须位于当前公共 Git 目录的 requests 下，是普通文件，拒绝符号链接和目录逃逸。
2. 检查当前工作区仍干净、分支和 HEAD 与 begin 一致；重算 remote 目标配置及 rulesHash，任何变化拒绝。
3. 校验结果基线等于请求 baseOid，reviewed/exempt 与实际 manifest 的文本及二进制计数一致。结果需携带本次 manifest 绝对路径，读取原始 manifest 校验，而非仅信任模型填写计数；拒绝 repositoryRoot/baseCommit 不符、非空 staged/unstaged/untracked 层。
4. 校验六路及必要核实任务完整有效，或满足明确的空材料豁免条件。不以 findings 严重程度拒绝。
5. 原子写入 completed/<scopeKey>.json：在同目录排他创建临时文件，写完并关闭后重命名。已有同 key 的有效登记可直接返回；损坏记录提示手工删除后重试，不静默覆盖。
6. 输出登记位置及 findings 数量。既有 skill 仍负责报告和材料清理；complete 只读取 manifest，不抢先删除 helper 临时目录。

因此显式推送审查的 skill 清理顺序需调整为：核查和报告 → complete 读取 manifest → 按既有条件清理准确 tempDirectory。任一 worker 停止状态不明时不得登记或清理。

同一请求并行 complete 只接受原子发布的完整记录，不实现运行锁、任务恢复或自动重试。请求文件保留供诊断，首版不自动清理。

## 9. pre-push 校验流程

1. 读取两个 Git hook 参数和完整 stdin；严格解析唯一更新行，拒绝畸形字段、超限输入和重复更新。
2. 检查首版支持范围；实际 localOid 必须等于当前 HEAD，local-ref 允许是当前完整分支名或 Git 对 HEAD 推送提供的 HEAD 标记，统一映射到当前分支。其他标记不猜测。
3. 校验实际 remote 参数对应配置中的唯一推送地址，remoteOid 非零、localOid 非零、对象存在且快进。禁止联网补查。
4. 根据实际 ref/OID、目标和当前 rulesHash 计算 scopeKey。
5. 读取并校验 completed 文件全部绑定字段、状态、六路任务/豁免结构。
6. 成功返回 0；缺失、失效、损坏或未完成返回非零。存在 findings 时展示计数但不阻止。

verify 不运行 manifest helper、不扫描业务代码、不启动 AI、不 fetch、不更改登记。整个过程中只读取本地对象、配置、规则及登记文件。

| 退出码 | 错误码 | 用户处理 |
| --- | --- | --- |
| 0 | REVIEW_RECORDED / EXEMPT / NO_UPDATES | 继续 Git 推送 |
| 1 | REVIEW_MISSING | 在宿主发起显式推送审查 |
| 2 | RECORD_INVALID | 查看错误，删除损坏记录并重新审查 |
| 3 | SCOPE_CHANGED | 对最新提交/远端基线重新 begin |
| 4 | REVIEW_INCOMPLETE | 查看 skill 报告，解决未完成原因后重新发起 |
| 5 | UNSUPPORTED_PUSH | 按首版支持范围操作，不自动绕过 |
| 6 | ENVIRONMENT_ERROR | 检查 Node、Git、hook 安装或本地权限 |

因新 scopeKey 找不到记录时通常返回 REVIEW_MISSING，无需为了区分“完全没有”和“旧登记失效”扫描所有记录。日志以 `[review-gate]` 开头，仅输出 ref、OID 缩写、原因及补审指引，不输出凭据或完整源码。

## 10. 失效及客户端行为

| 情况 | 结果 |
| --- | --- |
| 普通提交、amend、rebase 导致 HEAD 改变 | 新 OID 无登记，阻止 |
| 远端分支变化 | hook remoteOid 与 baseOid 不匹配，阻止 |
| 规则、skill、脚本或仓库 AGENTS.md 改变 | rulesHash 变化，阻止 |
| remote 地址、目标分支改变 | scopeKey 变化，阻止 |
| 普通未提交代码变化 | complete 前拒绝；登记后 verify 不审工作区，仍只匹配已登记提交 |
| 新 clone | 没有本地登记，需重新审查 |
| 仅文档等排除内容 | 满足空材料条件时登记 exempt，可推送 |
| 审查有问题但所有必要任务完成 | 记录 findings，允许推送 |
| 六路缺一、超时、失败、取消或输出无效 | 不登记完成，阻止 |
| `--no-verify` 或不执行 hook 的客户端 | 本地机制可被绕过，无法保证 |

GUI 可能不继承终端 PATH，需要确保 Node 在其 hook 环境可见；不在仓库硬编码个人路径。不能因终端测试通过就宣称编辑器或 Codex Git 界面已覆盖。

## 11. 测试、发布和验收

### 11.1 自动测试

在临时工作仓库和本地 bare remote 中验证，不使用真实远端：

- 正常 begin → 模拟完整结果 complete → push，远端 OID 正确更新。
- 缺登记、损坏 JSON、重复/缺失/额外规则、空 taskId、输出无效、核实任务失败均阻止。
- completed 且包含 Critical/Major 的结果可以登记，验证“不按严重程度拦截”的约定。
- HEAD、基线、规则、目标变化均阻止；complete 期间工作区变脏也拒绝。
- 空文本无二进制生成 exempt；非排除二进制不能误放行。
- 新分支、多 ref、强推、标签、删除、浅克隆和 detached HEAD 明确拒绝。
- CRLF、中文/空格路径、SHA-1/SHA-256、linked worktree、原子写入和并行 complete。
- 工作区审查不为无关 HEAD 生成登记；默认自动审查行为保持不变。
- `--no-verify` 可绕过，测试明确记录其边界。

模拟结果只验证门禁脚本逻辑，不证明真实 skill 完成。单独执行一次真实六路 skill，并验证登记与失败路径。

### 11.2 客户端验收

终端、团队实际编辑器、Codex Git 界面分别实测三种状态：缺登记阻止，有登记成功，新增提交后再次阻止。保存实际 hook 输出并验证远端 ref，而非只观察 UI 提示。GUI 额外验证重启后 PATH 和 Node 缺失提示。

安装先检查并合并实际 pre-push，再运行 Husky 安装并确认 hooksPath；保留原有 lint/typecheck 等检查。若没有可用宿主完成真实 skill，不启用会让所有开发者无法取得登记的强制门禁。

### 11.3 本次与后续实现的区别

本次仅重写方案文档，不创建脚本、不修改 skill 或 hook，不触发自动代码审查。

后续实际新增脚本、配置或测试时，完成实现和验证后按 AGENTS.md 自动调用一次现有 code-review skill，只审查并报告，不自动修复。该自动工作区审查不等同于显式推送范围登记。

