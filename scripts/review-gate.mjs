#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, linkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rules = ['standards', 'architect', 'devops', 'product_contract', 'runtime_performance', 'security']
const codes = { REVIEW_MISSING: 1, RECORD_INVALID: 2, SCOPE_CHANGED: 3, REVIEW_INCOMPLETE: 4, UNSUPPORTED_PUSH: 5, ENVIRONMENT_ERROR: 6 }
class GateError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
function fail(code, message) { throw new GateError(code, message) }
const hash = value => createHash('sha256').update(value).digest('hex')
function git(args, allowed = [0]) {
  const result = spawnSync('git', ['--no-replace-objects', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' } })
  if (result.error || !allowed.includes(result.status)) fail('ENVIRONMENT_ERROR', `Git ${args[0]} 执行失败（诊断已隐藏，避免泄露目标凭据）`)
  return result.stdout.trim()
}
function config(args) { return git(['config', ...args], [0, 1]).split('\n').filter(Boolean) }
function plainFile(path) {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) fail('RECORD_INVALID', '文件缺失或不是普通文件')
}
function json(path) {
  plainFile(path)
  if (lstatSync(path).size > 2 * 1024 * 1024) fail('RECORD_INVALID', 'JSON 文件超过 2 MiB')
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { fail('RECORD_INVALID', 'JSON 无法解析') }
}
function within(base, path) {
  const rel = relative(realpathSync(base), realpathSync(path))
  if (!rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) fail('RECORD_INVALID', '文件路径越界')
}
function store() {
  const base = resolve(git(['rev-parse', '--git-common-dir']), 'review-gate/v1')
  for (const path of [dirname(base), base]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('RECORD_INVALID', '登记目录不能是符号链接')
  return base
}
function publish(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  if (lstatSync(dirname(path)).isSymbolicLink()) fail('RECORD_INVALID', '登记目录不能是符号链接')
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try { linkSync(temp, path) }
  catch (error) { if (error.code !== 'EEXIST') throw error; return false }
  finally { unlinkSync(temp) }
  return true
}
function branch() {
  const ref = git(['symbolic-ref', '--quiet', 'HEAD'], [0, 1])
  if (!ref.startsWith('refs/heads/')) fail('UNSUPPORTED_PUSH', '必须检出本地分支')
  return ref
}
function clean() {
  if (git(['status', '--porcelain=v1', '--untracked-files=all'])) fail('SCOPE_CHANGED', '工作区必须干净，请先提交或保存修改')
}
function environment() {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') fail('UNSUPPORTED_PUSH', '不支持浅克隆')
  if (existsSync(git(['rev-parse', '--git-path', 'info/grafts']))) fail('UNSUPPORTED_PUSH', '不支持 grafts')
}
function target(remoteName) {
  if (!git(['remote']).split('\n').includes(remoteName)) fail('UNSUPPORTED_PUSH', '只支持命名 remote')
  if (config(['--get-regexp', '^url\\.']).length || config(['--get-all', `remote.${remoteName}.receivepack`]).length) fail('UNSUPPORTED_PUSH', '不支持 URL 重写或自定义 receivepack')
  const urls = config(['--get-all', `remote.${remoteName}.pushurl`])
  const selected = urls.length ? urls : config(['--get-all', `remote.${remoteName}.url`])
  if (selected.length !== 1) fail('UNSUPPORTED_PUSH', '要求唯一推送地址')
  return selected[0]
}
function oid(value) {
  const length = git(['rev-parse', '--show-object-format']) === 'sha256' ? 64 : 40
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value) || /^0+$/.test(value)) fail('UNSUPPORTED_PUSH', '不支持新建、删除或无效 OID')
  if (git(['cat-file', '-t', value]) !== 'commit') fail('UNSUPPORTED_PUSH', '必须推送 commit')
}
function scope(remoteName, remoteRef, baseOid, headOid) {
  environment()
  if (typeof remoteRef !== 'string' || !remoteRef.startsWith('refs/heads/')) fail('UNSUPPORTED_PUSH', '目标必须是完整分支 ref')
  const validRef = spawnSync('git', ['check-ref-format', remoteRef], { stdio: 'ignore' })
  if (validRef.status !== 0) fail('UNSUPPORTED_PUSH', '目标分支 ref 无效')
  oid(baseOid); oid(headOid)
  const ancestor = spawnSync('git', ['--no-replace-objects', 'merge-base', '--is-ancestor', baseOid, headOid], { stdio: 'ignore' })
  if (ancestor.status !== 0 || baseOid === headOid) fail('UNSUPPORTED_PUSH', '只支持非空快进更新')
  return { version: 1, remoteName, pushUrlHash: hash(target(remoteName)), localRef: branch(), remoteRef, baseOid, headOid, rulesHash: fingerprint() }
}
function fingerprint() {
  const root = git(['rev-parse', '--show-toplevel'])
  const skill = join(root, '.agents/skills/code-review')
  const paths = [join(skill, 'SKILL.md'), join(root, 'scripts/review-gate.mjs')]
  function walk(directory, accept) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) fail('RECORD_INVALID', '规则资源不能是符号链接')
      if (entry.isDirectory()) walk(path, accept)
      else if (accept(entry.name)) paths.push(path)
    }
  }
  walk(join(skill, 'references'), name => name.endsWith('.md'))
  walk(join(skill, 'scripts'), name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
  for (const path of git(['ls-files', '-z']).split('\0').filter(Boolean)) if (path === 'AGENTS.md' || path.endsWith('/AGENTS.md')) paths.push(join(root, path))
  return hash(JSON.stringify([...new Set(paths)].map(path => { plainFile(path); return [relative(root, path).replaceAll('\\', '/'), hash(readFileSync(path))] }).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}
const fields = ['version', 'remoteName', 'pushUrlHash', 'localRef', 'remoteRef', 'baseOid', 'headOid', 'rulesHash']
const key = value => hash(JSON.stringify(fields.map(field => value[field])))
function same(actual, expected) {
  if (fields.some(field => actual[field] !== expected[field])) fail('SCOPE_CHANGED', '提交范围、目标或规则已变化，请重新 begin 和审查')
}
function results(value) {
  if (!value || value.completion !== 'completed' || !Array.isArray(value.tasks) || !Array.isArray(value.verificationTasks)) fail('REVIEW_INCOMPLETE', '审查未完整完成')
  if (!value.findings || !['critical', 'major', 'minor'].every(level => Number.isSafeInteger(value.findings[level]) && value.findings[level] >= 0)) fail('RECORD_INVALID', 'findings 计数无效')
  const all = [...value.tasks, ...value.verificationTasks]
  if (all.some(task => !task || typeof task.taskId !== 'string' || !task.taskId.trim() || task.status !== 'completed' || task.outputValid !== true) || new Set(all.map(task => task.taskId)).size !== all.length) fail('REVIEW_INCOMPLETE', '任务身份、终态或输出无效')
  if (value.coverage === 'exempt') {
    if (all.length || value.exemptReason !== 'no_reviewable_text' || Object.values(value.findings).some(count => count !== 0)) fail('RECORD_INVALID', '豁免记录无效')
  }
  else if (value.coverage !== 'reviewed' || value.tasks.length !== rules.length || new Set(value.tasks.map(task => task.ruleId)).size !== rules.length || !rules.every(rule => value.tasks.some(task => task.ruleId === rule))) fail('REVIEW_INCOMPLETE', '六路首轮任务不完整')
  if (value.verificationTasks.some(task => !value.tasks.some(first => first.taskId === task.parentTaskId && first.ruleId === task.ruleId))) fail('RECORD_INVALID', '核实任务前置身份无效')
}
function begin(options) {
  clean(); environment()
  const remoteName = options.remote; const remoteRef = options.target
  if (!remoteName || !remoteRef || !remoteRef.startsWith('refs/heads/')) fail('UNSUPPORTED_PUSH', '用法：begin --remote <name> --target refs/heads/<branch>')
  const listing = git(['ls-remote', '--refs', '--', target(remoteName), remoteRef]).split('\n').filter(Boolean).map(line => line.split(/\s+/)).filter(parts => parts[1] === remoteRef)
  if (listing.length !== 1) fail('UNSUPPORTED_PUSH', '目标分支必须已存在，请先 fetch 已有分支')
  const request = { ...scope(remoteName, remoteRef, listing[0][0], git(['rev-parse', 'HEAD'])), requestId: randomUUID(), startedAt: new Date().toISOString() }
  const requestPath = join(store(), 'requests', `${request.requestId}.json`)
  publish(requestPath, request)
  return { requestPath, ...request }
}
function complete(options) {
  if (!options.request || !options.result) fail('RECORD_INVALID', 'complete 要求 --request 和 --result')
  const requests = join(store(), 'requests')
  plainFile(options.request); within(requests, options.request)
  const request = json(options.request)
  if (request.version !== 1 || typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(request.requestId) || resolve(options.request) !== join(requests, `${request.requestId}.json`)) fail('RECORD_INVALID', '请求身份无效')
  clean()
  same(request, scope(request.remoteName, request.remoteRef, request.baseOid, git(['rev-parse', 'HEAD'])))
  const result = json(options.result)
  if (result.requestId !== request.requestId || result.manifestBaseOid !== request.baseOid || typeof result.manifestPath !== 'string' || !isAbsolute(result.manifestPath)) fail('RECORD_INVALID', '结果与请求不匹配')
  const manifest = json(result.manifestPath)
  const root = git(['rev-parse', '--show-toplevel'])
  if (typeof manifest.repositoryRoot !== 'string' || realpathSync(manifest.repositoryRoot) !== realpathSync(root) || manifest.mode !== 'fixed-point' || manifest.baseCommit !== request.baseOid || !Array.isArray(manifest.layers) || manifest.layers.length !== 4 || new Set(manifest.layers.map(layer => layer.kind)).size !== 4 || !['committed', 'staged', 'unstaged', 'untracked'].every(kind => manifest.layers.some(layer => layer.kind === kind))) fail('RECORD_INVALID', 'manifest 范围无效')
  for (const layer of manifest.layers) {
    if (!Array.isArray(layer.paths) || typeof layer.patchPath !== 'string') fail('RECORD_INVALID', 'manifest 层无效')
    plainFile(layer.patchPath)
    if (layer.kind !== 'committed' && (layer.paths.length || readFileSync(layer.patchPath).length)) fail('RECORD_INVALID', 'manifest 含未提交变更')
  }
  if (!Array.isArray(manifest.textFiles) || manifest.textFileCount !== manifest.textFiles.length || !Array.isArray(manifest.binaryFiles) || manifest.binaryFiles.length) fail('RECORD_INVALID', 'manifest 文本计数无效或包含二进制')
  if (result.coverage !== (manifest.textFileCount ? 'reviewed' : 'exempt')) fail('RECORD_INVALID', 'coverage 与 manifest 不一致')
  const expectedCommits = git(['log', `${request.baseOid}..${request.headOid}`, '--oneline']).split('\n').filter(Boolean)
  if (JSON.stringify(manifest.commits) !== JSON.stringify(expectedCommits)) fail('RECORD_INVALID', 'manifest 提交范围不符')
  results(result)
  const record = { ...request, coverage: result.coverage, completion: result.completion, tasks: result.tasks, verificationTasks: result.verificationTasks, findings: result.findings, ...(result.coverage === 'exempt' ? { exemptReason: result.exemptReason } : {}), completedAt: new Date().toISOString() }
  const recordPath = join(store(), 'completed', `${key(record)}.json`)
  if (!publish(recordPath, record)) { const existing = json(recordPath); same(existing, record); results(existing) }
  return { recordPath, findings: record.findings }
}
function verify(args, input) {
  if (Buffer.byteLength(input) > 65536) fail('UNSUPPORTED_PUSH', 'hook 输入超过限制')
  if (!input.trim()) return { status: 'NO_UPDATES' }
  const lines = input.trim().split(/\r?\n/)
  if (lines.length !== 1 || args.length !== 2) fail('UNSUPPORTED_PUSH', '只支持单 ref 更新')
  const parts = lines[0].split(' ')
  if (parts.length !== 4 || parts.some(part => !part)) fail('UNSUPPORTED_PUSH', 'hook 输入格式无效')
  const [localRef, headOid, remoteRef, baseOid] = parts
  const expected = scope(args[0], remoteRef, baseOid, headOid)
  if (args[1] !== target(args[0]) || ![expected.localRef, 'HEAD'].includes(localRef) || headOid !== git(['rev-parse', 'HEAD'])) fail('SCOPE_CHANGED', '实际推送与当前分支或目标不符')
  const recordPath = join(store(), 'completed', `${key(expected)}.json`)
  if (!existsSync(recordPath)) fail('REVIEW_MISSING', '缺少匹配登记，请在宿主发起显式推送审查：begin --remote <name> --target <ref>')
  plainFile(recordPath); within(store(), recordPath)
  const record = json(recordPath); same(record, expected); results(record)
  return { status: record.coverage === 'exempt' ? 'EXEMPT' : 'REVIEW_RECORDED', findings: record.findings }
}
export function main(argv = process.argv.slice(2), input) {
  try {
    const [command, ...args] = argv
    let value
    if (command === 'verify') value = verify(args, input ?? readFileSync(0, 'utf8'))
    else {
      const options = {}
      for (let i = 0; i < args.length; i += 2) {
        if (!['--remote', '--target', '--request', '--result'].includes(args[i]) || !args[i + 1] || options[args[i].slice(2)]) fail('RECORD_INVALID', '命令参数无效')
        options[args[i].slice(2)] = args[i + 1]
      }
      if (command === 'begin') value = begin(options)
      else if (command === 'complete') value = complete(options)
      else fail('UNSUPPORTED_PUSH', '支持命令：begin / complete / verify')
    }
    process.stdout.write(`${JSON.stringify(value)}\n`)
    return 0
  }
  catch (error) {
    const code = error instanceof GateError ? error.code : 'ENVIRONMENT_ERROR'
    process.stderr.write(`[review-gate] ${code}: ${error instanceof GateError ? error.message : '本地文件或环境异常，请检查权限和安装'}\n`)
    return codes[code]
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
