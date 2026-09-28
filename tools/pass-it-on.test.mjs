// Headless Chrome (CDP) acceptance tests for pass-it-on.html — no npm dependencies.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const FILE = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const url = "file:///" + FILE.replace(/\\/g, "/");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pio-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const events = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json")).json();
      const page = list.find(t => t.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); break; }
    } catch {}
    await sleep(200);
  }
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d); };
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error("JS error: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
}
let pass = 0, fail = 0;
function check(name, cond, extra = "") { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name, extra); } }
const click = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error('missing ${sel.replace(/'/g, "")}'); e.click(); return true})()`);
const text = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.trim()`);
const pickLang = l => ev(`(()=>{const s=document.querySelector('#lang-select'); s.value='${l}'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value})()`);
const cards = () => ev(`({p:+document.querySelector('#stat-pending').textContent, a:+document.querySelector('#stat-available').textContent, n:+document.querySelector('#stat-nophysical').textContent})`);
async function load() { await send("Page.navigate", { url }); await sleep(700); }
async function viewport(w, h, mobile = false) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(250); }
async function shot(name) { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); }
async function fullShot(name) {
  const h = await ev("document.documentElement.scrollHeight"); const w = await ev("window.innerWidth");
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64"));
}

await connect();
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");
// Offline: block the network entirely.
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await viewport(1366, 768);
await load();
await ev("localStorage.clear()"); await load();

console.log("\n# Static source checks");
const src = fs.readFileSync(FILE, "utf8");
check("no http(s) URLs in source", !/https?:\/\//i.test(src), (src.match(/https?:\/\/\S+/gi) || []).join(" "));
check("no external src/href/@import", !/(src|href)\s*=\s*["'](?!#)[^"']+["']/i.test(src.replace(/href="#main"/, "")) && !/@import/i.test(src));
check("no 'net shortage' / 'adjusted' / 'covered by' wording", !/net shortage|adjusted need|covered by book bank/i.test(src));
const keysets = await ev(`Object.fromEntries(Object.entries(I18N).map(([k,v])=>[k,Object.keys(v).sort().join('|')]))`);
check("all 4 languages have identical key sets", new Set(Object.values(keysets)).size === 1 && Object.keys(keysets).length === 4);
const crcFnSrc = await ev("crcView.toString() + officialRows.toString() + officialRowFor.toString() + ownRows.toString() + demandLines.toString() + statementDoc.toString()");
check("CRC/statement code never reads Book Bank data", !/copies|localFigures|noPhysical|holder|covering/.test(crcFnSrc));

console.log("\n# Initial state (60 entitled, 50 received)");
let c = await cards();
check("pending=10", c.p === 10, JSON.stringify(c)); check("bank available=7", c.a === 7); check("no physical copy=10", c.n === 10);
check("hero statement visible", (await text("#hero-h")).includes("Books move to the child"));
check("permanent rule visible", (await ev("document.body.innerText")).includes("A donated or borrowed book never closes a government textbook shortage"));
check("exactly 4 primary action buttons", (await ev("document.querySelectorAll('.action').length")) === 4);
check("Works Offline tab removed", !(await ev("document.body.innerText")).includes("Works Offline"));
check("language is a dropdown with 4 options", (await ev("document.querySelectorAll('#lang-select option').length")) === 4);
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url).filter(u => !u.startsWith("file:") && !u.startsWith("data:"));
check("no network requests", reqs.length === 0, reqs.join(", "));
await fullShot("01-school-en-1366");

console.log("\n# Add a Book");
await click('[data-action="open-add"]');
check("add dialog open", await ev("document.querySelector('#dlg').open"));
check("no edition question; asks which book", (await text("#dlg")).includes("Which book is it?") && !(await text("#dlg")).includes("edition?"));
check("one button per class+subject (3)", (await ev("document.querySelectorAll('#dlg [data-action=add-to]').length")) === 3);
await shot("17-add-which-book");
await click('#dlg [data-action="add-to"][autofocus]');
c = await cards(); check("book added to current class: stock 8", c.a === 8);
check("new copy code BB-6-SCI-008", (await text("#dlg")).includes("BB-6-SCI-008"));
check("add does not change official pending", c.p === 10);
await click('#dlg [data-action="close"]');
check("focus returned to Add button", await ev("document.activeElement?.dataset.action === 'open-add'"));
// return to baseline for the mandatory demo
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');
c = await cards(); check("reset restores 10/7/10", c.p === 10 && c.a === 7 && c.n === 10);

console.log("\n# MANDATORY DEMO A — give Asha a temporary copy");
await click('[data-action="open-give"]');
const firstChoice = await ev("document.querySelector('#dlg input[name=child]:checked').closest('label').querySelector('.who').textContent");
check("Asha preselected (longest wait first)", firstChoice === "Asha");
check("give dialog does NOT claim issued before confirming", !(await text("#dlg")).includes("Temporary book issued"));
await shot("02-give-dialog");
await click('[data-action="give-confirm"]');
c = await cards();
check("official pending remains 10", c.p === 10, JSON.stringify(c));
check("Book Bank available becomes 6", c.a === 6);
check("children without any physical copy becomes 9", c.n === 9);
const dlgText = await text("#dlg");
check("confirmation says shortage unchanged: 10", dlgText.includes("Government shortage is unchanged: 10"));
await shot("03-give-result");
await click('#dlg [data-action="close"]');
const ashaRow = await ev("[...document.querySelectorAll('#view tbody tr')].find(r=>r.textContent.includes('Asha')).textContent");
check("Asha status = Temporary copy issued", ashaRow.includes("Temporary copy issued") && ashaRow.includes("BB-6-SCI-001"));

console.log("\n# Persistence");
await load();
c = await cards(); check("state persists after reload (10/6/9)", c.p === 10 && c.a === 6 && c.n === 9);

console.log("\n# CRC view after lending (privacy)");
await click('[data-action="set-role"][data-role="crc"]');
const crcText = await ev("document.querySelector('#view').innerText");
const crcHtml = await ev("document.documentElement.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/g,'')");
check("CRC School A pending = 10", await ev("document.querySelector('#crc-table tbody tr').children[6].textContent.trim()") === "10");
check("CRC School A longest pending = 31 days", (await ev("document.querySelector('#crc-table tbody tr').children[7].textContent")).includes("31"));
const leaks = ["BB-6", "Asha", "Ravi", "Meena", "Arjun", "Pass It On copies", "ready to lend", "still without any book", "Book Bank shelf", "temporary copies issued", "Children without any physical copy"].filter(w => crcHtml.includes(w));
check("CRC DOM contains no Book Bank / borrower data", leaks.length === 0, leaks.join(", "));
check("CRC shows privacy notice", crcText.includes("deliberately does not contain donated stock"));
check("CRC shows demand signal 60 not 30", crcText.includes("60 students for this class") && crcText.includes("30"));
check("CRC rows B and C present", crcText.includes("Govt School B") && crcText.includes("Govt School C"));
check("CRC has no 6/7 numbers derived from bank (School A row)", !(await ev("document.querySelector('#crc-table tbody tr').textContent")).match(/\b6\b.*\b9\b/));
await fullShot("04-crc-en-1366");
// print statement from CRC
await send("Emulation.setEmulatedMedia", { media: "print" });
await ev("document.querySelector('#print-root').innerHTML = statementDoc()");
const printVisible = await ev("getComputedStyle(document.querySelector('.screen')).display === 'none' && getComputedStyle(document.querySelector('#print-root')).display === 'block'");
check("print media hides app chrome, shows statement", printVisible);
await send("Emulation.setEmulatedMedia", { media: "" });
await click('[data-action="set-role"][data-role="school"]');

console.log("\n# MANDATORY DEMO B — 10 official books arrive");
await click('[data-action="open-govt"]');
check("govt qty defaults to pending (10)", (await ev("document.querySelector('#qty').value")) === "10");
// invalid entry check
await ev("document.querySelector('#qty').value='99'"); await click('[data-action="govt-confirm"]');
check("invalid qty rejected with message", (await text("#qty-err")).includes("1 to 10") && (await cards()).p === 10);
await ev("document.querySelector('#qty').value='10'");
await click('[data-action="govt-confirm"]');
c = await cards();
check("official pending becomes 0", c.p === 0, JSON.stringify(c));
check("children without physical copy 0", c.n === 0);
check("Book Bank stays separate (6 on shelf, not reset)", c.a === 6);
const govText = await text("#dlg");
check("recall message shown (Asha BB-6-SCI-001)", govText.includes("Temporary copies can now be recalled") && govText.includes("BB-6-SCI-001"));
check("received shows 60", (await ev("document.querySelector('[data-stat=pending] .ledger__note').textContent")).includes("60 govt books received"));
await shot("05-govt-result");
await click('#dlg [data-action="goto-return"]');
check("recall shortcut opens return list", (await text("#dlg")).includes("Asha"));
await click('#dlg [data-action="close"]');
await click('[data-action="set-role"][data-role="crc"]');
check("CRC shows 0 pending for School A", (await ev("document.querySelector('#crc-table tbody tr').children[6].textContent")).trim().startsWith("0"));
check("CRC longest pending School A = 0 days", (await ev("document.querySelector('#crc-table tbody tr').children[7].textContent")).includes("0"));
await click('[data-action="set-role"][data-role="school"]');

console.log("\n# Book Returned");
await click('[data-action="open-return"]');
await click('#dlg [data-action="return-one"][data-code="BB-6-SCI-001"]');
c = await cards(); check("return increases stock 6 → 7", c.a === 7);
check("return does not change official pending", c.p === 0);
await click('#dlg [data-action="close"]');

console.log("\n# Partial delivery keeps logic consistent");
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');
await click('[data-action="open-give"]'); await click('[data-action="give-confirm"]'); await click('#dlg [data-action="close"]'); // Asha
await click('[data-action="open-give"]'); await click('[data-action="give-confirm"]'); await click('#dlg [data-action="close"]'); // Ravi
c = await cards(); check("two lent: 10/5/8", c.p === 10 && c.a === 5 && c.n === 8, JSON.stringify(c));
await click('[data-action="open-govt"]'); await ev("(()=>{const q=document.querySelector('#qty'); q.value='3'; q.dispatchEvent(new Event('input',{bubbles:true}))})()"); await click('[data-action="govt-confirm"]');
c = await cards(); check("3 arrive (Asha, Ravi, Meena): pending 7, no-copy 7", c.p === 7 && c.n === 7, JSON.stringify(c));
await click('#dlg [data-action="close"]');
check("CRC longest now Salim 18 days", (await ev("officialRowFor(currentGroup()).longest")) === 18);
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');
// Exhaust shelf
for (let i = 0; i < 7; i++) { await click('[data-action="open-give"]'); await click('[data-action="give-confirm"]'); await click('#dlg [data-action="close"]'); }
c = await cards(); check("7 lent: 10/0/3", c.p === 10 && c.a === 0 && c.n === 3, JSON.stringify(c));
await click('[data-action="open-give"]');
check("empty shelf message", (await text("#dlg")).includes("No Pass It On copy is on the shelf"));
await click('#dlg [data-action="close"]');
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');

console.log("\n# Classes, subjects and the waiting list");
const setVal = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value})()`);
check("demo has 3 class buttons", (await ev("document.querySelectorAll('[data-action=pick-class]').length")) === 3);
check("why-line explains the red number", (await ev("document.querySelector('.why').textContent")).includes("still owes that child"));
check("old confusing two-counts panel is gone", !(await ev("document.body.innerText")).includes("No book at all today"));
await click('[data-action="pick-class"][data-cls="7"]');
check("Class 7 button shows its subject: Maths", (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Maths"));
c = await cards(); check("Class 7 Maths: 4 pending, 3 on shelf", c.p === 4 && c.a === 3, JSON.stringify(c));
await click('[data-action="open-add"]');
await click('#dlg [data-action="add-to"][data-id="' + (await ev("sortedGroups().find(g=>g.cls==='6').id")) + '"]');
check("adding a Class 6 book from Class 7 switches to Class 6 and adds BB-6-SCI-008", (await text("#dlg")).includes("BB-6-SCI-008") && (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Class 6"));
await click('#dlg [data-action="close"]');
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');
await click('[data-action="open-group-new"][data-scope="subject"]');
check("+ Add subject keeps the class fixed", (await text("#dlg-title")).includes("Add a subject to Class 6") && !(await ev("!!document.querySelector('#f-class')?.options")));
await click('#dlg [data-action="close"]');
await click('[data-action="open-group-new"]');
await setVal("#f-class", "10"); await setVal("#f-subject", "english");
await setVal("#f-entitled", "30"); await setVal("#f-received", "40");
await click('[data-action="group-save"]');
check("received > entitled is rejected", ((await text("#dlg .error")) || "").includes("cannot be more"));
await setVal("#f-entitled", "40"); await setVal("#f-received", "35"); await setVal("#f-last", "38");
await click('[data-action="group-save"]');
await shot("16-group-added"); check("new class saved and selected", (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Class 10") && (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("English"));
c = await cards(); check("new class: 5 pending, 0 copies, 5 without a book", c.p === 5 && c.a === 0 && c.n === 5, JSON.stringify(c));
check("unnamed children flagged", (await ev("document.querySelector('#view').innerText")).includes("5 more children are still owed a book"));
await click('#dlg [data-action="open-list"]');
check("list dialog opens from 'Add children now'", (await text("#dlg-title")).includes("have not received"));
await setVal("#names", "Ananya\nKiran\n\n  Rohit  ");
await click('[data-action="list-add"]');
check("3 names added (blank lines ignored, spaces trimmed)", (await text("#dlg .namecount")).includes("3 of 5"), await text("#dlg .namecount"));
await setVal("#names", "Kiran");
await click('[data-action="list-add"]');
check("duplicate name refused", ((await text("#dlg .error")) || "").includes("Already on the list: Kiran"));
await setVal("#names", "Zoya\nVikram\nNeha");
await click('[data-action="list-add"]');
check("cannot name more children than books pending", ((await text("#dlg .error")) || "").includes("Only 2 more names"));
await setVal("#names", "<img src=x onerror=window.__xss=1>\nNeha");
await click('[data-action="list-add"]');
await shot("13-list-dialog"); check("5 of 5 named", (await text("#dlg .namecount")).includes("5 of 5"));
check("typed names are shown as text, never run as code", (await ev("document.querySelectorAll('#view img, #dlg img').length")) === 0 && !(await ev("window.__xss")) && (await ev("document.querySelector('#view').innerText")).includes("<img src=x"));
await click('#dlg [data-action="close"]');
check("unnamed warning gone", !(await ev("document.querySelector('#view').innerText")).includes("more children are still owed"));
await click('[data-action="open-add"]'); await click('#dlg [data-action="add-to"][autofocus]');
check("copy code follows class+subject: BB-10-ENG-001", (await text("#dlg")).includes("BB-10-ENG-001"));
await click('#dlg [data-action="close"]');
await click('[data-action="open-give"]'); await click('[data-action="give-confirm"]'); await click('#dlg [data-action="close"]');
c = await cards(); check("lend in new class: pending stays 5, 0 on shelf, 4 without", c.p === 5 && c.a === 0 && c.n === 4, JSON.stringify(c));
await click('[data-action="open-govt"]');
await setVal("#qty", "1");
await shot("14-govt-ticks"); check("changing the number re-ticks the longest-waiting child", (await ev("document.querySelectorAll('#dlg input[name=got]:checked').length")) === 1);
await ev("[...document.querySelectorAll('#dlg input[name=got]')].slice(0,2).forEach(b=>{b.checked=true})");
await click('[data-action="govt-confirm"]');
check("more ticks than books is refused", ((await text("#qty-err")) || "").includes("ticked 2 children but recorded only 1"), await text("#qty-err"));
await setVal("#qty", "2");
await click('[data-action="govt-confirm"]');
c = await cards(); check("2 govt books: pending 5 → 3", c.p === 3, JSON.stringify(c));
await click('#dlg [data-action="close"]');
await click('[data-action="open-group-edit"]');
await setVal("#f-entitled", "38");
await click('[data-action="group-save"]');
check("edit cannot drop entitled below the named waiting list", ((await text("#dlg .error")) || "").includes("too low"));
await setVal("#f-entitled", "42"); await click('[data-action="group-save"]');
c = await cards(); check("enrolment raised to 42: pending 5", c.p === 5, JSON.stringify(c));
await click('[data-action="open-list"]');
const removable = await ev("document.querySelectorAll('#dlg [data-action=list-remove]').length");
const beforeRows = await ev("document.querySelectorAll('#dlg .rows li').length");
await click('#dlg [data-action="list-remove"]');
check("child can be removed; child holding a copy cannot", (await ev("document.querySelectorAll('#dlg .rows li').length")) === beforeRows - 1 && removable === beforeRows - 1, `${removable}/${beforeRows}`);
await click('#dlg [data-action="close"]');
await load();
check("selected class persists after reload", (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Class 10"));
await click('[data-action="set-role"][data-role="crc"]');
const crc2 = await ev("document.documentElement.outerHTML.replace(/<script[\\s\\S]*?<\\/script>/g,'')");
await fullShot("15-crc-classes"); check("CRC lists one row per class+subject (4 own + 2 other)", (await ev("document.querySelectorAll('#crc-table tbody tr').length")) === 6);
check("CRC shows Class 10 English with 5 pending", await ev("[...document.querySelectorAll('#crc-table tbody tr')].some(r=>r.children[2].textContent==='10' && r.children[6].textContent.trim()==='5')"));
const leaks2 = ["Ananya", "Kiran", "Rohit", "Neha", "BB-10", "BB-6", "Arjun", "Asha"].filter(w => crc2.includes(w));
check("CRC still has no names or copy codes after adding classes", leaks2.length === 0, leaks2.join(", "));
await click('[data-action="set-role"][data-role="school"]');
check("statement from School view lists every class", (await ev("statementDoc()")).includes("English") && (await ev("statementDoc()")).includes("Maths"));
await click('[data-action="open-reset"]'); await click('[data-action="reset-confirm"]');
check("reset returns to Class 6 Science", (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Class 6") && (await ev("(document.querySelector('[data-action=pick-class][aria-pressed=true]').textContent + ' | ' + document.querySelector('[data-action=pick-group][aria-pressed=true]').textContent)")).includes("Science"));

console.log("\n# Languages");
const english = ["Government books still pending", "Book Bank books ready to lend", "Children still without any book", "Which book is it?", "Add a Book", "Give a Book", "Book Returned", "Govt Books Arrived", "Waiting", "Print monthly shortage statement", "Official Textbook Shortage", "Students entitled", "Longest pending", "Reset demo", "School only", "None", "Add subject", "Change student count", "Add or remove children", "Names listed"];
for (const lang of ["hi", "or", "mr", "en"]) {
  await pickLang(lang);
  const schoolTxt = await ev("document.body.innerText");
  await click('[data-action="set-role"][data-role="crc"]');
  const crcTxt = await ev("document.body.innerText");
  await click('[data-action="set-role"][data-role="school"]');
  // dialogs
  let dlgTxt = "";
  for (const a of ["open-add", "open-give", "open-return", "open-govt", "open-reset"]) { await click(`[data-action="${a}"]`); dlgTxt += await text("#dlg"); await click('#dlg [data-action="close"]'); }
  const statement = await ev("statementDoc()"), sheet = await ev("sheetDoc()");
  if (lang !== "en") {
    const all = schoolTxt + crcTxt + dlgTxt + statement + sheet;
    const leftover = english.filter(w => all.includes(w));
    check(`${lang}: no key English labels left`, leftover.length === 0, leftover.join(" | "));
    check(`${lang}: html lang set`, (await ev("document.documentElement.lang")) === lang);
  }
}
await pickLang('or');
await load();
check("language persists after reload", (await ev("document.documentElement.lang")) === "or");
await fullShot("06-school-or-1366");
await click('[data-action="set-role"][data-role="crc"]'); await fullShot("07-crc-or-1366");
await click('[data-action="set-role"][data-role="school"]');

console.log("\n# Clipping / overflow checks");
async function overflowCheck(label) {
  const r = await ev(`(()=>{const bad=[];const docW=document.documentElement.clientWidth;
    if(document.documentElement.scrollWidth>docW+1) bad.push('page scrollX '+document.documentElement.scrollWidth+'>'+docW);
    document.querySelectorAll('#view *, .topbar *').forEach(el=>{const cs=getComputedStyle(el); if(el.closest('.sr-only')) return; if(el.closest('.table-wrap')&&getComputedStyle(el.closest('.table-wrap')).overflowX==='auto') return;
      if(el.children.length===0 && el.textContent.trim() && (el.scrollWidth>el.clientWidth+2) && cs.overflow!=='visible' && cs.display!=='inline') bad.push(el.className+':'+el.textContent.slice(0,30));
      const r=el.getBoundingClientRect(); if(r.width>0 && r.right>docW+1 && !el.closest('.table-wrap')) bad.push('offscreen '+el.tagName+'.'+el.className+' '+Math.round(r.right));});
    return bad.slice(0,8);})()`);
  check(`${label}: no horizontal overflow/clipping`, r.length === 0, JSON.stringify(r));
}
for (const lang of ["en", "hi", "or", "mr"]) {
  await pickLang(lang);
  await viewport(1366, 768); await overflowCheck(`${lang} 1366 school`);
  await viewport(390, 844, true); await overflowCheck(`${lang} 390 school`);
  if (lang === "or" || lang === "en") { await fullShot(`08-school-${lang}-390`); await ev("scrollTo(0,0)"); await shot(`08b-top-${lang}-390`); }
  await click('[data-action="set-role"][data-role="crc"]'); await overflowCheck(`${lang} 390 crc`);
  if (lang === "or" || lang === "en") await fullShot(`09-crc-${lang}-390`);
  await click('[data-action="set-role"][data-role="school"]');
  await click('[data-action="open-give"]'); await shot(`10-give-${lang}-390`); await click('#dlg [data-action="close"]');
  await viewport(1366, 768);
}
await viewport(768, 1024, true); await pickLang('mr'); await overflowCheck("mr 768 school"); await fullShot("11-school-mr-768");
await viewport(1366, 768);

console.log("\n# Keyboard: Esc closes dialog, touch target sizes");
await pickLang('en');
await click('[data-action="open-add"]');
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(150);
check("Esc closes dialog", !(await ev("document.querySelector('#dlg').open")));
const small = await ev(`[...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.getBoundingClientRect()).filter(r=>r.height<40).length`);
check("all visible buttons ≥ 40px tall", small === 0, small);
const bodyFont = await ev("parseFloat(getComputedStyle(document.body).fontSize)");
check("body text ≥ 16px", bodyFont >= 16);

console.log("\n# Print PDFs");
await ev("window.addEventListener('beforeprint',()=>{window.__printed=document.querySelector('#print-root').innerText})");
// Give Asha a copy first so we can prove the statement omits it.
await click('[data-action="open-give"]'); await click('[data-action="give-confirm"]'); await click('#dlg [data-action="close"]');
for (const [kind, lang, role] of [["statement", "en", "school"], ["statement", "hi", "crc"], ["sheet", "en", "school"], ["sheet", "or", "school"]]) {
  await pickLang(lang);
  await click(`[data-action="set-role"][data-role="${role}"]`);
  await ev(`document.querySelector('#print-root').innerHTML = ${kind === "sheet" ? "sheetDoc()" : "statementDoc()"}`);
  const r = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(OUT, `print-${kind}-${lang}-${role}.pdf`), Buffer.from(r.result.data, "base64"));
  if (kind === "sheet") check(`sheet ${lang} printed (rules present)`, (await ev("window.__printed")).includes(lang === "en" ? "Donations are voluntary" : "ଦାନ ସ୍ୱେଚ୍ଛାକୃତ"));
  if (kind === "statement") {
    const doc = await ev("window.__printed");
    check(`statement ${lang}/${role} has no Book Bank data`, !/BB-6|Asha|Pass It On copies/.test(doc) && doc.includes("10"));
  }
}
await pickLang('en'); await click('[data-action="set-role"][data-role="school"]');
await ev("document.querySelector('#print-root').innerHTML=''");
{ const r = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(path.join(OUT, "print-ctrlP-default.pdf"), Buffer.from(r.result.data, "base64")); }
check("Ctrl+P with nothing queued prints the official statement", (await ev("window.__printed")).includes("Monthly Textbook Shortage Statement"));

console.log("\n# Phone demo wrapper (opened ALONE, no pass-it-on.html beside it)");
await viewport(1366, 768);
const lone = fs.mkdtempSync(path.join(os.tmpdir(), "lone-"));
fs.copyFileSync(FILE.replace("pass-it-on.html", "phone-demo.html"), path.join(lone, "phone-demo.html"));
await send("Page.navigate", { url: "file:///" + path.join(lone, "phone-demo.html").replace(/\\/g, "/") }); await sleep(1500);
const fr = "document.getElementById('app').contentDocument";
const inner = await ev(`(()=>{const d=${fr}; return d && d.querySelector('#stat-pending') ? {w:d.documentElement.clientWidth, pending:d.querySelector('#stat-pending').textContent, avail:d.querySelector('#stat-available').textContent, actions:d.querySelectorAll('.action').length} : null})()`);
check("phone demo works with no other file present", !!inner && inner.actions === 4, JSON.stringify(inner));
check("phone demo renders the app at 390px (mobile layout)", !!inner && inner.w === 390, JSON.stringify(inner));
await ev(`${fr}.querySelector('[data-action=open-give]').click()`); await sleep(150);
await ev(`${fr}.querySelector('[data-action=give-confirm]').click()`); await sleep(150);
const after = await ev(`({p:${fr}.querySelector('#stat-pending').textContent, a:${fr}.querySelector('#stat-available').textContent})`);
check("give flow works inside phone frame (pending unchanged, shelf −1)", !!inner && after.p === inner.pending && Number(after.a) === Number(inner.avail) - 1, JSON.stringify({ inner, after }));
await ev(`${fr}.querySelector('#dlg [data-action=close]').click()`); await sleep(150);
await fullShot("12-phone-demo");

const errs = events.filter(e => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params.entry.level === "error"));
check("no console errors / exceptions", errs.length === 0, JSON.stringify(errs).slice(0, 500));

console.log(`\n${pass} passed, ${fail} failed`);
ws.close(); chrome.kill();
process.exit(fail ? 1 : 0);
