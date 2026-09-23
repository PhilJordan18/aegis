#!/usr/bin/env node
/*
 * Prototype checks (Node >= 22 + local Chrome, no dependency):
 *   1. syntax  — every lib/data/tools .js parses; every inline <script> of every HTML parses;
 *   2. chrono  — fixture assertions against 09 v1.3 (QR 60 s from creation, 47 s left at 10:39:50;
 *                physical window 120 s from authorization, confirmation before expiry;
 *                dueAt = reservedUntil; currentWindow open, closesAt 17:00 local, nextOpensAt null);
 *   3. future  — renders each built screen (A light) in headless Chrome, reads its visible text and
 *                fails if it shows a time later than the screen moment that is not a known deadline.
 *
 *   node tools/check.mjs            → exit 1 on any failure
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failures++; };
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "renders" ? [] : walk(p)) : [p]; });

// ------------------------------------------------------------------ 1. syntax
console.log("== syntax ==");
const files = walk(ROOT);
for (const f of files.filter(f => f.endsWith(".js"))) {
  try { new vm.Script(readFileSync(f, "utf8"), { filename: f }); ok(true, relative(ROOT, f)); }
  catch (e) { ok(false, `${relative(ROOT, f)}: ${e.message}`); }
}
for (const f of files.filter(f => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let bad = null;
  blocks.forEach((code, i) => { try { new vm.Script(code, { filename: `${f}#${i}` }); } catch (e) { bad = `${i}: ${e.message}`; } });
  ok(!bad, `${relative(ROOT, f)} (${blocks.length} inline script${blocks.length > 1 ? "s" : ""})${bad ? " — " + bad : ""}`);
}

// ------------------------------------------------------------------ 2. chrono
console.log("\n== chronology (fixture vs 09 v1.3) ==");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, "data/fixture.js"), "utf8"), ctx);
const fx = ctx.window.AEGIS_FIXTURE;
const t = iso => new Date(iso).getTime() / 1000;
const op = fx.checkoutOperation;
const local = iso => new Intl.DateTimeFormat("en-CA", { timeZone: fx.meta.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
ok(t(op.localProofExpiresAt) - t(op.createdAt) === 60, `QR expires 60 s after creation (${op.createdAt} → ${op.localProofExpiresAt}) — 09 §15.5`);
ok(t(op.localProofExpiresAt) - t(fx.moments["10:39"].at) === 47 && fx.snapshots["10:39"].operation.secondsLeft === 47, "47 s left at 10:39:50 (snapshot secondsLeft = 47)");
ok(t(op.localProofDisplayedAt) >= t(op.createdAt) && t(op.authorizedAt) <= t(op.localProofExpiresAt), "code displayed after creation; authorized before QR expiry");
ok(op.localProofValidatedAt === op.authorizedAt, "localProofValidatedAt = authorizedAt — 09 §15.5");
ok(t(op.expiresAt) - t(op.authorizedAt) === 120, `physical window 120 s from authorization (${op.authorizedAt} → ${op.expiresAt})`);
ok(t(op.authorizedAt) < t(op.commandSentAt) && t(op.commandSentAt) < t(op.acknowledgedAt) && t(op.acknowledgedAt) < t(op.doorOpenedAt) && t(op.doorOpenedAt) < t(op.observationReceivedAt) && t(op.observationReceivedAt) <= t(op.confirmedAt), "authorized < sent < acknowledged < door opened < observation ≤ confirmed");
ok(t(op.confirmedAt) < t(op.expiresAt), `confirmation (${op.confirmedAt}) before physical expiry (${op.expiresAt})`);
ok(fx.loan.dueAt === fx.reservation.reservedUntil, `loan.dueAt = reservation.reservedUntil (${fx.loan.dueAt})`);
ok(fx.loan.checkedOutAt === op.confirmedAt && fx.reservation.fulfilledAt === op.confirmedAt, "checkedOutAt = fulfilledAt = confirmedAt");
const cw = fx.currentWindow;
ok(cw.open === true && local(cw.closesAt) === "17:00" && cw.nextOpensAt === null, `currentWindow open=${cw.open}, closesAt ${cw.closesAt} = ${local(cw.closesAt)} local, nextOpensAt=${cw.nextOpensAt} — 09 §8.6`);
const diag = fx.snapshots["10:30"].assets;
ok(JSON.stringify(diag["MM-001"].operationalDiagnostic.reasons) === "[]" && JSON.stringify(diag["MM-002"].operationalDiagnostic.reasons) === '["CALIBRATION_EXPIRED"]' && !("result" in diag["MM-002"].operationalDiagnostic), "operationalDiagnostic 10:30: MM-001 [], MM-002 [CALIBRATION_EXPIRED], no result field — 09 §8.9");
const noAccessDenied = Object.values(fx.snapshots).every(s => !s.assets || Object.values(s.assets).every(a => !a.operationalDiagnostic || !a.operationalDiagnostic.reasons.includes("ACCESS_DENIED")));
ok(noAccessDenied && !JSON.stringify(fx).includes("adminDiagnostic"), "no ACCESS_DENIED in operationalDiagnostic; no legacy adminDiagnostic");
ok(fx.snapshots["10:39"].reservation.currentOperationId === op.id && fx.snapshots["10:43"].reservation.currentOperationId === null && fx.snapshots["10:43"].loan.currentOperationId === null, "currentOperationId: checkout op while reservation ACTIVE; null once FULFILLED; loan null (no return attempt) — 09 §8.3–8.4");
ok(fx.anomaly.detectedAt > op.confirmedAt && t(fx.anomaly.detectedAt) < t(fx.moments["11:20"].at), "anomaly detected after checkout confirmation and before 11:20");

// ------------------------------------------------------------------ 3. future timestamps in rendered text
console.log("\n== rendered text: no future timestamps ==");
const screens = JSON.parse(readFileSync(join(ROOT, "data/screens.js"), "utf8").match(/\/\*JSON-START\*\/([\s\S]*?)\/\*JSON-END\*\//)[1]).filter(s => s.status === "built");
const secOfDay = iso => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: fx.meta.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)); const g = k => +p.find(x => x.type === k).value; return g("hour") * 3600 + g("minute") * 60 + g("second"); };
// Deadlines may be later than the moment by nature (a chosen or computed limit, not an accomplished fact).
const deadlines = new Set([fx.reservation.reservedUntil, fx.loan.dueAt, cw.closesAt, op.localProofExpiresAt, op.expiresAt].map(secOfDay));
const deadlineLabel = [...deadlines].map(s => `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`).join(", ");
console.log(`  deadlines allowed: ${deadlineLabel}`);

const profile = mkdtempSync(join(tmpdir(), "aegis-check-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--allow-file-access-from-files", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((res, rej) => { let b = ""; chrome.stderr.on("data", d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); setTimeout(() => rej(new Error("Chrome did not start")), 20000); });
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NB = "[\\s\\u00A0]";
const reHM = new RegExp(`(\\d{1,2})${NB}h${NB}(\\d{2})(?:${NB}min${NB}(\\d{2})${NB}s)?`, "g");
const reClock = /\b(\d{2}):(\d{2})(?::(\d{2}))?\b/g;
for (const s of screens) {
  const url = pathToFileURL(join(ROOT, "screens", s.platform, `${s.n}-${s.slug}.html`)).href + "?treatment=a&theme=light";
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", { url }, sessionId);
  await sleep(1200);
  const { result } = await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true }, sessionId);
  await send("Target.closeTarget", { targetId });
  const text = result.value;
  const moment = secOfDay(fx.moments[s.moment].at);
  const found = [];
  for (const m of text.matchAll(reHM)) found.push({ raw: m[0].replace(/ /g, " "), sec: +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0) });
  for (const m of text.matchAll(reClock)) found.push({ raw: m[0], sec: +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0) });
  const future = found.filter(f => f.sec > moment && !deadlines.has(f.sec) && !deadlines.has(f.sec - (f.sec % 60)));
  ok(future.length === 0, `${s.id} @ ${fx.moments[s.moment].label}: ${found.length} times shown${future.length ? " — FUTURE: " + future.map(f => f.raw).join(", ") : ""}`);
}
ws.close(); chrome.kill(); await sleep(800);
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp */ }

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}`);
process.exit(failures ? 1 : 0);
