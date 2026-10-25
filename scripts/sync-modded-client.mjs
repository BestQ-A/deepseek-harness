#!/usr/bin/env node
/**
 * sync-modded-client.mjs
 *
 * 一键构建并同步魔改版 DeepSeek Harness (DSH) 客户端：
 * 0. 同步 ~/.dsh/plugins/dsh-hermes-bridge 至 desktop profile 与宿主内置 node_modules
 * 1. 从 dsh-hermes-bridge 重新生成 83 智能体三区嵌套组织树数据 (hermes-org-data.ts)
 * 2. 编译 @deepseek-ai/dsh-client-ui-workspace (输出 lib/client.js)
 * 3. 同步至：
 *    - 本机已解包桌面端目录 (AppData/Local/Programs/DeepSeek Harness/resources/app/...)
 *    - 源码仓 win-x64 打包暂存树 (apps/desktop/.desktop-build/targets/win-x64/dsh/...)
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

/**
 * Pick a node binary that can actually write to this checkout.
 *
 * The nvm4w shim (`C:/nvm4w/nodejs/node.exe`) is denied write access to F: and to
 * the temp dir on this machine, so any build launched through it dies with
 * "Access is denied (os error 5)" even though the same build succeeds under
 * `C:/Program Files/nodejs/node.exe`. Everything below launches through this
 * resolved path instead of `process.execPath`, so the caller's shell decides
 * nothing about whether the build can write.
 */
function resolveWritableNode() {
  const candidates = [
    'C:/Program Files/nodejs/node.exe',
    process.execPath,
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    const probe = path.join(REPO_ROOT, `.node-write-probe-${process.pid}`)
    try {
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      return candidate
    } catch {
      /* not writable from this binary; try the next candidate */
    }
  }
  return process.execPath
}

const NODE_EXE = resolveWritableNode()
if (NODE_EXE !== process.execPath) {
  console.log(`[node] using writable runtime: ${NODE_EXE}`)
}

/**
 * Every child inherits this PATH, with the writable node's directory first.
 *
 * `pnpm exec <tool>` re-launches the tool through the `node` it finds on PATH,
 * not through the binary that started pnpm — so fixing `execFileSync`'s first
 * argument alone still let the nvm4w shim run the actual bundler and fail with
 * EPERM. Prepending the writable runtime's directory makes every grandchild
 * resolve to it as well.
 */
const CHILD_ENV = {
  ...process.env,
  PATH: `${path.dirname(NODE_EXE)}${path.delimiter}${process.env.PATH ?? ''}`,
}

const PLUGIN_SRC = 'C:/Users/Administrator/.dsh/plugins/dsh-hermes-bridge'
const PLUGIN_DESTS = [
  'C:/Users/Administrator/.dsh/profiles/desktop/node_modules/dsh-hermes-bridge',
  'C:/Users/Administrator/.dsh/profiles/surgery/node_modules/dsh-hermes-bridge',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/dsh-hermes-bridge',
  'F:/3_open_source/hermes-process-check/dsh-hermes-bridge',
]
const GENERATOR_SCRIPT = 'F:/3_open_source/hermes-process-check/dsh-hermes-bridge/generate-dsh-ui-mod.mjs'
const BUILT_PRESET_REGISTRY_JS = path.join(REPO_ROOT, 'packages/preset/agent-preset-registry/lib/index.js')
const TARGET_PRESET_REGISTRY_PATHS = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/index.js',
  path.join(REPO_ROOT, 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh-agent-preset-registry/lib/index.js'),
]

const BUILT_CLIENT_JS = path.join(REPO_ROOT, 'packages/client/ui-workspace/lib/client.js')

const TARGET_PATHS = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
  path.join(REPO_ROOT, 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'),
]

const BUILT_CONVERSATION_CLIENT_JS = path.join(REPO_ROOT, 'packages/client/ui-conversation/lib/client.js')

const TARGET_CONVERSATION_PATHS = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
  path.join(REPO_ROOT, 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),
]

const BUILT_MODEL_SELECTION_CLIENT_JS = path.join(REPO_ROOT, 'packages/client/ui-model-selection/lib/client.js')

const TARGET_MODEL_SELECTION_PATHS = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js',
  path.join(REPO_ROOT, 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'),
]

if (fs.existsSync(PLUGIN_SRC)) {
  console.log('[0/5] Syncing dsh-hermes-bridge plugin files...')
  for (const dest of PLUGIN_DESTS) {
    try {
      if (fs.existsSync(path.dirname(dest))) {
        fs.mkdirSync(path.join(dest, 'lib'), { recursive: true })
        fs.copyFileSync(path.join(PLUGIN_SRC, 'package.json'), path.join(dest, 'package.json'))
        if (fs.existsSync(path.join(PLUGIN_SRC, 'cordis.patch.yml'))) {
          fs.copyFileSync(path.join(PLUGIN_SRC, 'cordis.patch.yml'), path.join(dest, 'cordis.patch.yml'))
        }
        if (fs.existsSync(path.join(PLUGIN_SRC, 'client.js'))) {
          fs.copyFileSync(path.join(PLUGIN_SRC, 'client.js'), path.join(dest, 'client.js'))
        }
        for (const f of fs.readdirSync(path.join(PLUGIN_SRC, 'lib'))) {
          fs.copyFileSync(path.join(PLUGIN_SRC, 'lib', f), path.join(dest, 'lib', f))
        }
      }
    } catch (err) {
      console.warn(`  [warn] skipped ${dest}: ${err.message}`)
    }
  }
}

console.log('[1/4] Generating Hermes 83-agent organization data for DSH UI...')
if (fs.existsSync(GENERATOR_SCRIPT)) {
  execFileSync(NODE_EXE, [GENERATOR_SCRIPT], { stdio: 'inherit', env: CHILD_ENV })
}

const pnpmCandidates = [
  process.env.npm_execpath,
  'C:/Users/Administrator/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs',
].filter(Boolean)
const pnpmEntry = pnpmCandidates.find(p => fs.existsSync(p)) || pnpmCandidates[0]

console.log('[2/4] Building @deepseek-ai/dsh-agent-preset-registry, subagent & agent-team packages...')
execFileSync(NODE_EXE, [
  pnpmEntry,
  'exec',
  'tsc',
  '-b',
  'packages/preset/agent-preset-registry/tsconfig.json',
  'packages/subagent/subagent/tsconfig.json',
  'packages/subagent/tool-subagent/tsconfig.json',
  'packages/experimental/agent-team/tsconfig.json',
  'packages/experimental/tool-agent-team/tsconfig.json',
], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: CHILD_ENV,
})
if (fs.existsSync(BUILT_PRESET_REGISTRY_JS)) {
  for (const target of TARGET_PRESET_REGISTRY_PATHS) {
    if (!fs.existsSync(path.dirname(target))) continue
    const bak = `${target}.bak-official`
    if (fs.existsSync(target) && !fs.existsSync(bak)) {
      fs.copyFileSync(target, bak)
    }
    fs.copyFileSync(BUILT_PRESET_REGISTRY_JS, target)
    console.log(`  [synced preset-registry] ${target}`)
  }
}

const BACKEND_PACKAGES = [
  ['packages/preset/agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry'],
  ['packages/subagent/subagent', '@deepseek-ai/dsh-subagent'],
  ['packages/subagent/tool-subagent', '@deepseek-ai/dsh-tool-subagent'],
  ['packages/experimental/agent-team', '@deepseek-ai/dsh-experimental-agent-team'],
  ['packages/experimental/tool-agent-team', '@deepseek-ai/dsh-experimental-tool-agent-team'],
]
for (const [pkgDir] of BACKEND_PACKAGES) {
  execFileSync(NODE_EXE, [
    pnpmEntry,
    'exec',
    'tsdown',
    'lib/types/index.js',
    '--no-config',
    '--out-dir',
    'lib',
    '--format',
    'esm',
    '--platform',
    'node',
    '--target',
    'es2024',
    '--no-fixed-extension',
    '--no-dts',
    '--no-clean',
  ], {
    cwd: path.join(REPO_ROOT, pkgDir),
    stdio: 'inherit',
  env: CHILD_ENV,
  })
}

const BACKEND_PACKAGE_DIRS = BACKEND_PACKAGES.map(([pkgDir, pkgName]) => [`${pkgDir}/lib`, `${pkgName}/lib`])
const INSTALL_ROOTS = [
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules',
  path.join(REPO_ROOT, 'apps/desktop/.desktop-build/targets/win-x64/dsh/node_modules'),
]
function syncDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir) || !fs.existsSync(destDir)) return
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      syncDirRecursive(s, d)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      const bak = `${d}.bak-official`
      if (fs.existsSync(d) && !fs.existsSync(bak)) fs.copyFileSync(d, bak)
      fs.copyFileSync(s, d)
    }
  }
}
for (const [srcRel, pkgRel] of BACKEND_PACKAGE_DIRS) {
  const srcDir = path.join(REPO_ROOT, srcRel)
  if (!fs.existsSync(srcDir)) continue
  for (const root of INSTALL_ROOTS) {
    const destDir = path.join(root, pkgRel)
    if (!fs.existsSync(destDir)) continue
    syncDirRecursive(srcDir, destDir)
    console.log(`  [synced backend] ${destDir}`)
  }
}

const TEAM_PROFILE_PATCH_SRC = path.join(REPO_ROOT, 'packages/experimental/agent-team-profile/cordis.patch.yml')
if (fs.existsSync(TEAM_PROFILE_PATCH_SRC)) {
  for (const root of INSTALL_ROOTS) {
    const destPatch = path.join(root, '@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml')
    if (!fs.existsSync(path.dirname(destPatch))) continue
    const bak = `${destPatch}.bak-official`
    if (fs.existsSync(destPatch) && !fs.existsSync(bak)) fs.copyFileSync(destPatch, bak)
    fs.copyFileSync(TEAM_PROFILE_PATCH_SRC, destPatch)
    console.log(`  [synced team-profile patch] ${destPatch}`)
  }
}

console.log('[3/6] Bundling @deepseek-ai/dsh-client-ui-workspace, ui-conversation & ui-model-selection...')
execFileSync(NODE_EXE, [pnpmEntry, 'exec', 'tsc', '-b', 'packages/client/ui-workspace/tsconfig.json', 'packages/client/ui-model-selection/tsconfig.json'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: CHILD_ENV,
})
execFileSync(NODE_EXE, [pnpmEntry, '--filter', '@deepseek-ai/dsh-client-ui-workspace', 'run', 'bundle'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: CHILD_ENV,
})
execFileSync(NODE_EXE, [pnpmEntry, '--filter', '@deepseek-ai/dsh-client-ui-conversation', 'run', 'bundle'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: CHILD_ENV,
})
execFileSync(NODE_EXE, [pnpmEntry, '--filter', '@deepseek-ai/dsh-client-ui-model-selection', 'run', 'bundle'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: CHILD_ENV,
})

if (!fs.existsSync(BUILT_CLIENT_JS)) {
  throw new Error(`Missing built artifact: ${BUILT_CLIENT_JS}`)
}

const stat = fs.statSync(BUILT_CLIENT_JS)
console.log(`[4/5] Syncing modded ui-workspace client.js (${(stat.size / 1024).toFixed(2)} kB)...`)

for (const target of TARGET_PATHS) {
  const dir = path.dirname(target)
  if (!fs.existsSync(dir)) {
    console.log(`  [skip] ${target} (directory not present)`)
    continue
  }
  const bak = `${target}.bak-official`
  if (fs.existsSync(target) && !fs.existsSync(bak)) {
    fs.copyFileSync(target, bak)
  }
  fs.copyFileSync(BUILT_CLIENT_JS, target)
  console.log(`  [synced] ${target}`)
}

if (fs.existsSync(BUILT_CONVERSATION_CLIENT_JS)) {
  const convStat = fs.statSync(BUILT_CONVERSATION_CLIENT_JS)
  console.log(`[5/6] Syncing modded ui-conversation client.js (${(convStat.size / 1024).toFixed(2)} kB)...`)
  for (const target of TARGET_CONVERSATION_PATHS) {
    const dir = path.dirname(target)
    if (!fs.existsSync(dir)) continue
    const bak = `${target}.bak-official`
    if (fs.existsSync(target) && !fs.existsSync(bak)) {
      fs.copyFileSync(target, bak)
    }
    fs.copyFileSync(BUILT_CONVERSATION_CLIENT_JS, target)
    console.log(`  [synced] ${target}`)
  }
}

if (fs.existsSync(BUILT_MODEL_SELECTION_CLIENT_JS)) {
  const modelStat = fs.statSync(BUILT_MODEL_SELECTION_CLIENT_JS)
  console.log(`[6/6] Syncing modded ui-model-selection client.js (${(modelStat.size / 1024).toFixed(2)} kB)...`)
  for (const target of TARGET_MODEL_SELECTION_PATHS) {
    const dir = path.dirname(target)
    if (!fs.existsSync(dir)) continue
    const bak = `${target}.bak-official`
    if (fs.existsSync(target) && !fs.existsSync(bak)) {
      fs.copyFileSync(target, bak)
    }
    fs.copyFileSync(BUILT_MODEL_SELECTION_CLIENT_JS, target)
    console.log(`  [synced] ${target}`)
  }
}

console.log('Done! Modded DSH client UI workspace is up to date.')
