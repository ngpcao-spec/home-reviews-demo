import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Generated build artifact only; include lazy routes for an offline cold start.
const outDir=resolve(process.argv[2] || 'dist')
const assets=(await readdir(resolve(outDir,'assets'))).map(name=>`assets/${name}`).sort()
const swUrl=resolve(outDir,'sw.js')
const source=await readFile(swUrl,'utf8')
const revision=createHash('sha256').update(source+assets.join('\n')).digest('hex').slice(0,12)
await writeFile(swUrl,source.replace('home-reviews-shell-v3',`home-reviews-shell-${revision}`)
  .replace('const ASSETS = [] // BUILD_ASSETS',`const ASSETS = ${JSON.stringify(assets)}`))
