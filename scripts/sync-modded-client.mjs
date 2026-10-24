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
  execFileSync(process.execPath, [GENERATOR_SCRIPT], { stdio: 'inherit' })
}

const pnpmCandidates = [
  process.env.npm_execpath,
  'C:/Users/Administrator/AppData/Roaming/npm/node_modules/pnpm/bin/pnpm.cjs',
  'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs',
].filter(Boolean)
const pnpmEntry = pnpmCandidates.find(p => fs.existsSync(p)) || pnpmCandidates[0]

console.log('[2/4] Building @deepseek-ai/dsh-agent-preset-registry...')
execFileSync(process.execPath, [pnpmEntry, 'exec', 'tsc', '-b', 'packages/preset/agent-preset-registry/tsconfig.json'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
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

console.log('[3/5] Bundling @deepseek-ai/dsh-client-ui-workspace & @deepseek-ai/dsh-client-ui-conversation...')
execFileSync(process.execPath, [pnpmEntry, 'exec', 'tsc', '-b', 'packages/client/ui-workspace/tsconfig.json'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
})
execFileSync(process.execPath, [pnpmEntry, '--filter', '@deepseek-ai/dsh-client-ui-workspace', 'run', 'bundle'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
})
execFileSync(process.execPath, [pnpmEntry, '--filter', '@deepseek-ai/dsh-client-ui-conversation', 'run', 'bundle'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
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
  console.log(`[5/5] Syncing modded ui-conversation client.js (${(convStat.size / 1024).toFixed(2)} kB)...`)
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

console.log('Done! Modded DSH client UI workspace is up to date.')
