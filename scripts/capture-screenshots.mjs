import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const output=resolve('artifacts/screenshots')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})
const page=await context.newPage()
await page.addInitScript(()=>localStorage.clear())
const routes=[
  ['/','01_accueil.png'],
  ['/etablissements','02_etablissements.png'],
  ['/etablissements/est-1','03_detail_etablissement.png'],
  ['/avis','04_avis_a_traiter.png'],
  ['/analyses','05_analyses.png'],
  ['/plus','06_plus_parametres.png'],
]
for(const [route,file] of routes){await page.goto(`http://127.0.0.1:4173${route}`,{waitUntil:'networkidle'});await page.screenshot({path:resolve(output,file)})}
await browser.close()
console.log(`Captures enregistrées dans ${output}`)
