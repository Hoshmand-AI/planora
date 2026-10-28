import { chromium } from 'playwright'
import fs from 'fs'
const BASE='http://localhost:3999', out=process.argv[2]
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
for (const [tag, vp] of [['desk',{width:1366,height:900}],['phone',{width:390,height:844}]]) {
  const ctx = await b.newContext({ viewport: vp }); const page = await ctx.newPage()
  await page.request.post(`${BASE}/api/auth`, { headers:{origin:BASE}, data:{ action:'signup', name:'Ahmad Noori', email:`ov${Date.now()}${tag}@example.com`, password:'correct horse battery staple', company:'Noori Builders' } })
  const up = await (await page.request.post(`${BASE}/api/schedules`, { headers:{origin:BASE}, multipart:{ file:{ name:'sample.xer', mimeType:'application/octet-stream', buffer:fs.readFileSync('src/lib/parsers/__fixtures__/sample.xer') } } })).json()
  await page.goto(`${BASE}/dashboard/project?schedule=${up.schedule.id}`,{waitUntil:'networkidle'}); await page.waitForTimeout(1500)
  await page.screenshot({ path:`${out}/${tag}-overview.png`, fullPage: tag==='desk' })
  await ctx.close()
}
await b.close()
