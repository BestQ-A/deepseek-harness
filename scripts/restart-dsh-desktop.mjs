import { execFileSync, spawn } from 'node:child_process'

const exePath = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe'

try {
  execFileSync('taskkill.exe', ['/F', '/IM', 'DeepSeek Harness.exe'], { stdio: 'ignore' })
} catch {
  // process might not be running
}

await new Promise(resolve => setTimeout(resolve, 1500))

const child = spawn(exePath, [], {
  detached: true,
  stdio: 'ignore',
})
child.unref()

await new Promise(resolve => setTimeout(resolve, 6500))
console.log('DeepSeek Harness desktop restarted cleanly.')
