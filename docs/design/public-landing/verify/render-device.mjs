/*
 * Renders the landing's device states from Jimmy's three.js scene
 * (../source/casier-aegis-l-01.html, kept as received) with the Playwright Chromium
 * of apps/admin-web (run `npm ci --ignore-scripts` there first):
 *   node docs/design/public-landing/verify/render-device.mjs
 * Writes transparent 2400×2600 PNGs into ../assets/device/.
 *
 * The scene itself is never edited: a patched copy is written to a temporary directory.
 * Needs network once per run: the scene loads three.js r128 and OrbitControls from CDNs.
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '../../../../apps/admin-web/package.json'))
const { chromium } = require('@playwright/test')

const src = resolve(here, '../source/casier-aegis-l-01.html')
const outDir = resolve(here, '../assets/device')
mkdirSync(outDir, { recursive: true })
let html = readFileSync(src, 'utf8')

function patch(from, to) {
  if (!html.includes(from)) throw new Error('patch anchor not found: ' + from.slice(0, 60))
  html = html.replace(from, to)
}
// transparent canvas, no backdrop, no fog, no floor glow
patch("new THREE.WebGLRenderer({canvas,antialias:true})", "new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true})")
patch("scene.background=new THREE.Color('#EEF0F4'); scene.fog=new THREE.Fog('#EEF0F4',3.4,8);", "scene.background=null;")
patch("glow.rotation.x=-Math.PI/2; glow.position.y=.001; scene.add(glow);", "glow.rotation.x=-Math.PI/2; glow.position.y=.001;")
// neutral, unlit screen: the landing composes the screen content in HTML (FR/EN, themes)
patch("screen:new THREE.MeshBasicMaterial({map:screenTex,toneMapped:false})", "screen:new THREE.MeshStandardMaterial({color:'#0B0F16',roughness:.25,metalness:.1})")
patch("const sl=new THREE.PointLight('#5E7EF6',.4,.5);sl.position.set(.078,0,.08);pv.add(sl);", "")
// no printed candidate reference on the service door (not an approved designation)
patch("const sub=plane(.11,.0137,textTex('HUB · CASIER L-01',{w:512,size:26,weight:400,color:'#4F5767',x:8,y:44}));sub.position.set(.223,.023,.0145);pv.add(sub);", "")
// LEDs driven by window.__LED (id -> color; absent = off, no point light)
patch("function led(g,col){", "function led(g,col){ if(!col){const m=new THREE.Mesh(new THREE.CylinderGeometry(.0045,.0045,.002,24),new THREE.MeshStandardMaterial({color:'#2A3140',roughness:.4}));m.rotation.x=Math.PI/2;m.position.set(W/2-.03,H-.0045,D/2+.0165);g.add(m);return;}")
patch("enclosure(g,mod); led(g,ready?green:red);", "enclosure(g,mod); led(g,(window.__LED||{})[id]||null);")
patch("enclosure(g,mod); led(g,green);", "enclosure(g,mod); led(g,(window.__LED||{}).HUB||null);")
// drop the power brick and the trailing mains cable from the table pose
patch("if(!state.wall){\n      const bk=", "if(window.__POWER&&!state.wall){\n      const bk=")
// expose the closure so the harness can set doors and the camera
patch("apply(false);\n\n  // ---------- loop ----------", "apply(false);\n  window.__aegis={mods:()=>mods,go,camera,controls,frame};\n\n  // ---------- loop ----------")
// hide the page chrome; transparent, fixed-size stage
html = html.replace('</style>\n\n<div class="wrap">', '.ui,.hint,.note,.labels,.head,.specs,.foot{display:none!important}html,body{background:transparent!important}.stage{background:transparent!important;box-shadow:none!important;border-radius:0!important;height:1300px!important;width:1200px!important;max-width:none}body{padding:0!important}.wrap{max-width:none;gap:0}</style>\n\n<div class="wrap">')

const patched = resolve(mkdtempSync(resolve(tmpdir(), 'aegis-device-')), 'casier-patched.html')
writeFileSync(patched, html)

const LED_READY = '#1E9E5A'
const STATES = [
  { file: 'casier-ferme', a1: 0, led: {} },
  { file: 'casier-a1-ouverte', a1: 1, led: {} },
  { file: 'casier-ferme-voyant-a1', a1: 0, led: { A1: LED_READY } },
]

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
try {
  for (const st of STATES) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1300 }, deviceScaleFactor: 2 })
    page.on('pageerror', e => console.log('pageerror:', e.message))
    await page.addInitScript((led) => { window.__LED = led; window.__POWER = false }, st.led)
    await page.goto(pathToFileURL(patched).href)
    await page.waitForFunction(() => window.__aegis)
    await page.evaluate((open) => {
      const { mods, go, camera, controls, frame } = window.__aegis
      const a1 = mods().find(m => m.id === 'A1')
      a1.door.target = open; a1.door.cur = open
      go('front', true)
      // same framing for every state: pull back and centre slightly right/down
      camera.position.sub(frame.center).multiplyScalar(1.32).add(frame.center)
      controls.target.copy(frame.center).add(new THREE.Vector3(0.02, -0.02, 0))
    }, st.a1)
    await page.waitForTimeout(1500)
    const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))
    const out = resolve(outDir, st.file + '.png')
    writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('wrote', out.replace(resolve(here, '../..') + '/', ''))
    await page.close()
  }
} finally {
  await browser.close()
}
