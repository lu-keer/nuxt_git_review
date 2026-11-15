# Nuxt Git Hooks

## 环境与安装

使用 Node.js 22.21+ 和 Yarn 4.13.0（由 `packageManager` 固定）。

```sh
nvm install
nvm use
corepack enable
yarn install --immutable
yarn prepare
```

Yarn 安装时运行 `postinstall` 生成 Nuxt 配置并安装 Husky。`yarn prepare` 可用于修复 hooks 安装。新克隆、新 worktree 安装后应确认 hooks 路径。确认 `git config --get core.hooksPath` 输出 `.husky/_`。

## 开发与检查

```sh
yarn dev
yarn lint
yarn lint:fix
yarn typecheck
yarn check
yarn build
```

- 提交：`pre-commit` 使用 lint-staged 检查暂存的 Vue、JS、TS 文件；不自动修复。部分暂存时 lint-staged 隐藏并恢复未暂存修改。
- 推送：`pre-push` 对当前工作区运行全量 ESLint、Nuxt 类型检查。未提交修改也会影响结果；推送前保持工作区干净。
- 校验失败返回非零退出码，阻止 Git 操作；输出以 `[git-hook]` 标记开始，并将开始时间与退出码写入 `git rev-parse --git-path hook-checks.log` 指向的本地日志（不提交到仓库）。
- GitHub Actions 在 push、pull request 上执行相同检查及生产构建。本地 hooks 可被跳过，服务端仍须检查；分支保护需在 GitHub 单独设置。

## Codex 桌面端与 nvm

GUI 不一定继承交互式终端的 PATH。若使用 nvm，可在用户级 `~/.config/husky/init.sh` 中初始化：

```sh
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  if [ -f .nvmrc ]; then
    nvm use --silent || return 1
  fi
fi
```

设置默认 Node 为兼容版本。不要在仓库 hooks 中硬编码个人 Node 路径。启动失败时先检查 Node、Yarn 是否可见，不要通过跳过 hooks 解决。

## Codex GUI 验收操作

界面点击须由用户完成，终端运行 hooks 不能证明 GUI 会触发。

1. 暂存项目文件，输入提交说明，通过 Git 菜单“提交”。成功时应产生首次提交。
2. 临时在 Vue 文件的 `<script setup lang="ts">` 中加入 `const unusedHookProbe = 1` 并暂存，点击“提交”。应看到 `[git-hook] pre-commit` 和 ESLint 错误，HEAD 不变。恢复测试修改。
3. 同一文件分别准备暂存和未暂存修改，暂存内容正确时检查应通过，未暂存内容应保留。另验证带空格的文件名、删除文件及没有匹配文件时的提交。
4. 首次提交后，临时在 `app/hook-typecheck-probe.ts` 写入 `export const probe: string = 123`，不提交。点击“推送”，应看到 `[git-hook] pre-push`、类型错误，远端不变。移除测试文件。
5. 在干净工作区点击“推送”，确认成功，远端与本地 HEAD 一致，再检查 GitHub Actions。
6. 完全退出 Codex，从 Finder 重启，重复失败场景以验证 GUI PATH。

测试修改必须恢复；不要把故意出错的内容提交到远端。具体实测结果见 `docs/hooks-verification.md`。
