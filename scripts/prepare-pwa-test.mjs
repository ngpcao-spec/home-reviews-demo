import { copyFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
await copyFile('test-results/pwa-build/tests/e2e/fixtures/resume.html','test-results/pwa-build/index.html')
const result=spawnSync(process.execPath,['scripts/prepare-pwa.mjs','test-results/pwa-build'],{stdio:'inherit'})
process.exitCode=result.status??1
