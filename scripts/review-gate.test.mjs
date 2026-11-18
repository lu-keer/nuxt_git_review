import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const rules = ['standards', 'architect', 'devops', 'product_contract', 'runtime_performance', 'security']

function command(cwd, executable, args, input = '') {
  return spawnSync(executable, args, {
    cwd, input, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
  })
}

function git(cwd, args) {
  const result = command(cwd, 'git', args)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function write(root, path, value) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
  return target
}

function fixture(t, format = 'sha1') {
  const root = mkdtempSync(join(tmpdir(), 'review-gate-中文 空格-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'work')
  const remote = join(root, 'remote.git')
  mkdirSync(repo)
  git(repo, ['init', '--quiet', '--initial-branch=main', `--object-format=${format}`])
  git(repo, ['config', 'user.name', 'Review Gate Test'])
  git(repo, ['config', 'user.email', 'review-gate@example.invalid'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  git(repo, ['config', 'core.hooksPath', '.git/hooks'])
  cpSync(join(sourceRoot, '.agents/skills/code-review'), join(repo, '.agents/skills/code-review'), { recursive: true })
  mkdirSync(join(repo, 'scripts'))
  cpSync(join(sourceRoot, 'scripts/review-gate.mjs'), join(repo, 'scripts/review-gate.mjs'))
  write(repo, 'app.js', 'export const value = 1\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '--quiet', '-m', 'base'])
  git(repo, ['init', '--quiet', '--bare', `--object-format=${format}`, remote])
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '--quiet', 'origin', 'refs/heads/main'])
  const baseOid = git(repo, ['rev-parse', 'HEAD'])
  const f = { root, repo, remote, baseOid }
  f.commit = (path = 'app.js', value = 'export const value = 2\n') => {
    write(repo, path, value)
    git(repo, ['add', path])
    git(repo, ['commit', '--quiet', '-m', 'change'])
    return git(repo, ['rev-parse', 'HEAD'])
  }
  f.run = (args, input = '', cwd = repo) => command(cwd, process.execPath, [join(repo, 'scripts/review-gate.mjs'), ...args], input)
  f.begin = () => {
    const r = f.run(['begin', '--remote', 'origin', '--target', 'refs/heads/main'])
    assert.equal(r.status, 0, r.stderr)
    const started = JSON.parse(r.stdout)
    assert.equal(started.baseOid, baseOid)
    assert.equal(started.headOid, git(repo, ['rev-parse', 'HEAD']))
    const request = JSON.parse(readFileSync(started.requestPath, 'utf8'))
    return { ...started, request }
  }
  f.result = (started, changes = {}) => {
    const helper = command(repo, process.execPath, [join(repo, '.agents/skills/code-review/scripts/build-review-manifest.mjs'), '--base', started.baseOid])
    assert.equal(helper.status, 0, helper.stderr)
    const manifestPath = helper.stdout.trim()
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    t.after(() => rmSync(manifest.tempDirectory, { recursive: true, force: true }))
    const result = {
      requestId: started.request.requestId,
      manifestPath,
      manifestBaseOid: started.baseOid,
      completion: 'completed',
      coverage: manifest.textFileCount === 0 ? 'exempt' : 'reviewed',
      ...(manifest.textFileCount === 0 ? { exemptReason: 'no_reviewable_text' } : {}),
      tasks: manifest.textFileCount === 0 ? [] : rules.map(ruleId => ({ ruleId, taskId: `host-${ruleId}`, status: 'completed', outputValid: true })),
      verificationTasks: [],
      findings: { critical: 0, major: 0, minor: 0 },
      ...changes,
    }
    const resultPath = write(root, 'result.json', JSON.stringify(result))
    return { result, resultPath, manifest, manifestPath }
  }
  f.complete = (started, resultPath) => f.run(['complete', '--request', started.requestPath, '--result', resultPath])
  f.verify = (input) => f.run(['verify', 'origin', remote], input ?? `refs/heads/main ${git(repo, ['rev-parse', 'HEAD'])} refs/heads/main ${baseOid}\n`)
  f.installHook = () => {
    const quote = value => `'${value.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`
    write(repo, '.git/hooks/pre-push', `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(repo, 'scripts/review-gate.mjs'))} verify "$@"\n`)
    chmodSync(join(repo, '.git/hooks/pre-push'), 0o755)
  }
  return f
}

function finish(f, changes = {}) {
  const started = f.begin()
  const output = f.result(started, changes)
  const completed = f.complete(started, output.resultPath)
  return { started, output, completed }
}

test('缺登记阻止；完整六路登记允许 CRLF hook 输入及严重 findings', (t) => {
  const f = fixture(t)
  f.commit()
  assert.notEqual(f.verify().status, 0)
  const { completed } = finish(f, { findings: { critical: 1, major: 2, minor: 3 } })
  assert.equal(completed.status, 0, completed.stderr)
  const line = `refs/heads/main ${git(f.repo, ['rev-parse', 'HEAD'])} refs/heads/main ${f.baseOid}\r\n`
  assert.equal(f.verify(line).status, 0)
  assert.equal(f.verify('').status, 0)
})

test('缺失、重复、额外规则或无效输出不登记', (t) => {
  const f = fixture(t)
  f.commit()
  const started = f.begin()
  const output = f.result(started)
  const valid = output.result.tasks
  for (const tasks of [valid.slice(1), [...valid, valid[0]], [...valid, { ...valid[0], ruleId: 'summary', taskId: 'extra' }], valid.map((task, i) => i === 0 ? { ...task, outputValid: false } : task), valid.map((task, i) => i === 0 ? { ...task, taskId: '' } : task)]) {
    writeFileSync(output.resultPath, JSON.stringify({ ...output.result, tasks }))
    assert.notEqual(f.complete(started, output.resultPath).status, 0)
  }
  assert.notEqual(f.verify().status, 0)
})

test('失败核实任务及未完成结果不登记', (t) => {
  const f = fixture(t)
  f.commit()
  const started = f.begin()
  for (const changes of [{ completion: 'incomplete' }, { verificationTasks: [{ ruleId: 'security', taskId: 'verify-security', parentTaskId: 'host-security', status: 'failed', outputValid: false }] }]) {
    const output = f.result(started, changes)
    assert.notEqual(f.complete(started, output.resultPath).status, 0)
  }
})

test('HEAD、规则及目标基线变化使登记失效', (t) => {
  const f = fixture(t)
  f.commit()
  assert.equal(finish(f).completed.status, 0)
  assert.notEqual(f.verify(`refs/heads/main ${git(f.repo, ['rev-parse', 'HEAD'])} refs/heads/main ${git(f.repo, ['rev-parse', 'HEAD'])}\n`).status, 0)
  write(f.repo, '.agents/skills/code-review/references/standards.md', 'changed rule\n')
  assert.notEqual(f.verify().status, 0)
  git(f.repo, ['restore', '.agents/skills/code-review/references/standards.md'])
  f.commit('app.js', 'export const value = 3\n')
  assert.notEqual(f.verify().status, 0)
})

test('complete 拒绝脏工作区、错误 manifest 基线和未提交层', (t) => {
  const f = fixture(t)
  f.commit()
  const started = f.begin()
  const output = f.result(started)
  write(f.repo, 'untracked.js', 'export default 1\n')
  assert.notEqual(f.complete(started, output.resultPath).status, 0)
  rmSync(join(f.repo, 'untracked.js'))
  writeFileSync(output.manifestPath, JSON.stringify({ ...output.manifest, baseCommit: git(f.repo, ['rev-parse', 'HEAD']) }))
  assert.notEqual(f.complete(started, output.resultPath).status, 0)
  const layers = output.manifest.layers.map(layer => layer.kind === 'unstaged' ? { ...layer, paths: ['app.js'] } : layer)
  writeFileSync(output.manifestPath, JSON.stringify({ ...output.manifest, layers }))
  assert.notEqual(f.complete(started, output.resultPath).status, 0)
})

test('仅文档可 exempt，非排除二进制不能登记', (t) => {
  const f = fixture(t)
  f.commit('guide.md', '# docs\n')
  assert.equal(finish(f).completed.status, 0)
  assert.equal(f.verify().status, 0)
  f.commit('image.bin', Buffer.from([0, 1, 2, 0, 4]))
  assert.notEqual(finish(f).completed.status, 0)
})

test('不支持新分支、删除、多 ref、标签、非 HEAD 和非快进', (t) => {
  const f = fixture(t)
  f.commit()
  const head = git(f.repo, ['rev-parse', 'HEAD'])
  const zero = '0'.repeat(head.length)
  const line = `refs/heads/main ${head} refs/heads/main ${f.baseOid}\n`
  for (const input of [
    `refs/heads/main ${head} refs/heads/new ${zero}\n`,
    `(delete) ${zero} refs/heads/main ${f.baseOid}\n`,
    line + `refs/heads/main ${head} refs/heads/other ${f.baseOid}\n`,
    `refs/tags/v1 ${head} refs/tags/v1 ${f.baseOid}\n`,
    `refs/heads/main ${f.baseOid} refs/heads/main ${head}\n`,
    'malformed input\n',
  ]) assert.notEqual(f.verify(input).status, 0, input)
  assert.notEqual(f.run(['begin', '--remote', 'origin', '--target', 'refs/heads/new']).status, 0)
  git(f.repo, ['checkout', '--quiet', '--detach'])
  assert.notEqual(f.run(['begin', '--remote', 'origin', '--target', 'refs/heads/main']).status, 0)
})

test('损坏登记拒绝，不因存在文件而放行', (t) => {
  const f = fixture(t)
  f.commit()
  assert.equal(finish(f).completed.status, 0)
  const common = git(f.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const completed = join(common, 'review-gate/v1/completed')
  const [name] = readdirSync(completed)
  writeFileSync(join(completed, name), '{')
  assert.notEqual(f.verify().status, 0)
})

test('SHA-256 仓库完整登记与校验', (t) => {
  const f = fixture(t, 'sha256')
  f.commit()
  assert.equal(f.baseOid.length, 64)
  const { completed } = finish(f)
  assert.equal(completed.status, 0, completed.stderr)
  assert.equal(f.verify().status, 0)
})

test('linked worktree 使用共享 Git 公共目录', (t) => {
  const f = fixture(t)
  f.commit()
  git(f.repo, ['branch', 'linked'])
  const linked = join(f.root, 'linked worktree')
  git(f.repo, ['worktree', 'add', '--quiet', linked, 'linked'])
  const begun = f.run(['begin', '--remote', 'origin', '--target', 'refs/heads/main'], '', linked)
  assert.equal(begun.status, 0, begun.stderr)
  const started = JSON.parse(begun.stdout)
  const common = git(linked, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  assert.ok(resolve(started.requestPath).startsWith(resolve(common)))
})

test('真实 pre-push 阻止未登记，允许登记；no-verify 可绕过', (t) => {
  const f = fixture(t)
  f.commit()
  f.installHook()
  const push = () => command(f.repo, 'git', ['push', 'origin', 'HEAD:refs/heads/main'])
  assert.notEqual(push().status, 0)
  assert.equal(git(f.repo, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main']), f.baseOid)
  assert.equal(finish(f).completed.status, 0)
  const pushed = push()
  assert.equal(pushed.status, 0, pushed.stderr)
  const accepted = git(f.repo, ['rev-parse', 'HEAD'])
  assert.equal(git(f.repo, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main']), accepted)
  const next = f.commit('app.js', 'export const value = 3\n')
  assert.notEqual(push().status, 0)
  const bypass = command(f.repo, 'git', ['push', '--no-verify', 'origin', 'HEAD:refs/heads/main'])
  assert.equal(bypass.status, 0, bypass.stderr)
  assert.equal(git(f.repo, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main']), next)
})


test('remote URL 或目标分支变化不能复用登记', (t) => {
  const f = fixture(t)
  f.commit()
  assert.equal(finish(f).completed.status, 0)
  const head = git(f.repo, ['rev-parse', 'HEAD'])
  assert.notEqual(f.verify(`refs/heads/main ${head} refs/heads/other ${f.baseOid}\n`).status, 0)
  const other = join(f.root, 'other.git')
  git(f.repo, ['init', '--quiet', '--bare', other])
  git(f.repo, ['remote', 'set-url', 'origin', other])
  assert.notEqual(f.run(['verify', 'origin', other], `refs/heads/main ${head} refs/heads/main ${f.baseOid}\n`).status, 0)
})

test('并行 complete 只发布一份完整登记，可重复完成', async (t) => {
  const f = fixture(t)
  f.commit()
  const started = f.begin()
  const output = f.result(started)
  const args = [join(f.repo, 'scripts/review-gate.mjs'), 'complete', '--request', started.requestPath, '--result', output.resultPath]
  const complete = () => new Promise((resolveResult, reject) => {
    const p = spawn(process.execPath, args, { cwd: f.repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stderr = ''
    p.stderr.on('data', value => stderr += value)
    p.on('error', reject)
    p.on('close', code => resolveResult({ code, stderr }))
  })
  const results = await Promise.all([complete(), complete()])
  for (const result of results) assert.equal(result.code, 0, result.stderr)
  assert.equal(f.complete(started, output.resultPath).status, 0)
  assert.equal(f.verify().status, 0)
  const common = git(f.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  assert.equal(readdirSync(join(common, 'review-gate/v1/completed')).length, 1)
})


test('浅克隆在 begin 前明确拒绝', (t) => {
  const f = fixture(t)
  const shallow = join(f.root, 'shallow')
  git(f.repo, ['clone', '--quiet', '--depth=1', '--branch=main', pathToFileURL(f.remote).href, shallow])
  assert.equal(git(shallow, ['rev-parse', '--is-shallow-repository']), 'true')
  const begun = f.run(['begin', '--remote', 'origin', '--target', 'refs/heads/main'], '', shallow)
  assert.notEqual(begun.status, 0)
  assert.match(begun.stderr, /UNSUPPORTED_PUSH/)
})
