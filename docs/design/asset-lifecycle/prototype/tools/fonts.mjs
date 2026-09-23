#!/usr/bin/env node
/*
 * Report the fonts Chrome ACTUALLY rendered for every text node of the built
 * prototype screens, via the DevTools protocol (CSS.getPlatformFontsForNode).
 * No dependency: Node >= 22 (global WebSocket) + local Google Chrome.
 *
 *   node tools/fonts.mjs
 *
 * Output: per screen/treatment, each platform font family + PostScript name,
 * glyph count and whether it is a web (custom) font. isCustomFont must be
 * false everywhere: the prototype loads no font file and no network font.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TARGETS = [
  { file: "screens/ios/02-catalogue.html", w: 393, h: 852 },
  { file: "screens/web/02-equipements.html", w: 1440, h: 900 }
];

const profile = mkdtempSync(join(tmpdir(), "aegis-fonts-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--allow-file-access-from-files", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res, rej) => {
  let buf = "";
  chrome.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); });
  setTimeout(() => rej(new Error("Chrome did not start")), 20000);
});

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const listeners = [];
ws.addEventListener("message", ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else listeners.forEach(fn => fn(msg));
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const summary = {};
for (const t of TARGETS) {
  for (const treatment of ["a", "b"]) {
    const url = pathToFileURL(join(ROOT, t.file)).href + `?treatment=${treatment}&theme=light`;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width: t.w, height: t.h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.navigate", { url }, sessionId);
    await sleep(1500);
    await send("DOM.enable", {}, sessionId);
    await send("CSS.enable", {}, sessionId);
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: false }, sessionId);
    const elems = [];
    (function walk(n) {
      if (n.nodeType === 1 && (n.children || []).some(c => c.nodeType === 3 && c.nodeValue.trim())) elems.push(n.nodeId);
      (n.children || []).forEach(walk);
    })(root);
    const agg = {};
    for (const nodeId of elems) {
      try {
        const { fonts } = await send("CSS.getPlatformFontsForNode", { nodeId }, sessionId);
        for (const f of fonts) {
          const k = `${f.familyName} | ${f.postScriptName || "?"} | custom=${f.isCustomFont}`;
          agg[k] = (agg[k] || 0) + f.glyphCount;
        }
      } catch (e) { /* node without layout */ }
    }
    summary[`${t.file} ?treatment=${treatment}`] = agg;
    await send("Target.closeTarget", { targetId });
  }
}
for (const [k, agg] of Object.entries(summary)) {
  console.log(`\n${k}`);
  Object.entries(agg).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`  ${String(n).padStart(5)} glyphs  ${f}`));
}
ws.close(); chrome.kill();
await sleep(1000);
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp dir, OS cleans it */ }
