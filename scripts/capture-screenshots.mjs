import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const output=resolve('artifacts/screenshots')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})
const page=await context.newPage()
await page.addInitScript(()=>localStorage.clear())
const routes=[['/','01_dashboard_accueil.png'],['/etablissements','02_etablissements.png'],['/avis','03_avis_a_traiter.png'],['/avis/r1','04_detail_avis.png'],['/analyses','05_analyses.png']]
for(const [route,file] of routes){await page.goto(`http://127.0.0.1:4173${route}`,{waitUntil:'networkidle'});await page.screenshot({path:resolve(output,file),fullPage:true})}
await browser.close()
console.log(`Captures enregistrées dans ${output}`)
