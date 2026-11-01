/* eslint-disable no-console */
// Walks the full loop against the REAL route handlers (NEXT_PUBLIC_MOCK=0 SERVER_BACKEND=dev DEV_LOGIN=1 GAME_MODE=PLAY).
// Usage: node apps/web/src/ui/shoot/live.mjs [baseUrl] [outDir] [width] [name]
// Needs local Chrome (CHROME_PATH or the usual Windows locations). Screenshots: live-NN-step-<width>.png.
import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3117";
const OUT = resolve(process.argv[3] ?? "docs/screens");
const WIDTH = Number(process.argv[4] ?? 1280);
const NAME = process.argv[5] ?? `Tester${WIDTH}x${Date.now() % 10000}`;
mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set CHROME_PATH");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${WIDTH}]`, ...a);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: WIDTH < 600 ? 844 : 800, deviceScaleFactor: 1, isMobile: WIDTH < 600, hasTouch: WIDTH < 600 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400 && r.status() !== 404) errors.push(`http ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });

let n = 0;
const shot = async (name, full = false) => { await sleep(400); await page.screenshot({ path: `${OUT}/live-${String(++n).padStart(2, "0")}-${name}-${WIDTH}.png`, fullPage: full }); };
const click = async (sel) => { const el = await page.waitForSelector(sel, { visible: true, timeout: 10000 }); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await el.click(); };
const overflow = async (name) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); log(`${name}: scrollWidth ${o.sw} / ${o.iw} ${o.sw > o.iw ? "OVERFLOW" : "ok"}`); };
const balance = async () => page.$eval(".topbar .balance .num", (e) => e.textContent).catch(() => "?");
const navTab = async (label) => {
  const ok = await page.evaluate((l) => { const el = [...document.querySelectorAll("a.tab, a.navlink")].find((a) => a.textContent.trim() === l && a.offsetParent !== null); if (el) el.click(); return !!el; }, label);
  if (!ok) throw new Error(`nav tab ${label} not found`);
  await sleep(600);
};

// login
await page.goto(`${BASE}/play`, { waitUntil: "networkidle0" });
await page.waitForSelector("input.input", { timeout: 10000 });
await shot("login");
log("login form shown, google button present:", !!(await page.$("button::-p-text(Continue with Google)")));
await page.type("input.input", NAME);
const t0 = Date.now();
await click("button::-p-text(Play)");
await page.waitForSelector(".onboarding", { timeout: 30000 });
log(`login -> onboarding in ${Date.now() - t0} ms as ${NAME}`);
await shot("onboarding");
await click("button::-p-text(Next)");
await click("button::-p-text(Next)");
const hold = await page.$eval(".onboarding", (e) => e.textContent);
log("last card text:", hold.replace(/\s+/g, " ").slice(0, 200));
const claimBtn = await page.$("button::-p-text(Claim)");
if (claimBtn) { await claimBtn.click(); await page.waitForSelector(".toast", { timeout: 10000 }); log("faucet toast:", await page.$$eval(".toast", (els) => els.map((e) => e.textContent).join(" || "))); await shot("claimed"); }
else log("no claim button on onboarding");
await click("button::-p-text(Start trading)");
await page.waitForSelector(".mapcanvas", { timeout: 15000 });
await sleep(800);
log("balance after claim:", await balance());
await shot("map", true); await overflow("map");

// buy in Bandar
await click("a::-p-text(Open Bandar market)");
await page.waitForSelector(".goods");
await shot("market", true); await overflow("market");
const good = process.env.BUY_GOOD ?? "Grain";
await click(`button[aria-label="Buy ${good}"]`);
await page.waitForSelector("dialog[open] .cost");
await shot("buy-sheet");
log("buy preview:", await page.$eval("dialog[open] .cost", (e) => e.textContent));
await click("dialog[open] .sheet-foot button::-p-text(Buy for)");
await page.waitForSelector(".toast", { timeout: 10000 });
log("buy toast:", await page.$$eval(".toast", (els) => els.map((e) => e.className.replace("toast ", "") + ": " + e.textContent).join(" || ")));
await sleep(1500);
log("balance after buy:", await balance());
await shot("after-buy");

// plan with a guard
await click("a::-p-text(Plan a journey)");
await page.waitForSelector(".planner");
await sleep(600);
await click(".guard-pill:nth-child(2)");
await sleep(300);
await shot("planner", true); await overflow("planner");
log("destination:", await page.$eval(".dest.on .strong", (e) => e.textContent).catch(() => "none selected"));
log("summary:", (await page.$eval(".summary", (e) => e.textContent).catch(() => "?")).replace(/\s+/g, " "));
await click("button::-p-text(Send caravan to)");
await page.waitForSelector(".transit", { timeout: 15000 });
await shot("in-transit", true); await overflow("transit");
log("countdown:", await page.$eval(".countdown", (e) => e.textContent).catch(() => "?"));
log("balance in transit:", await balance());

// wait for arrival
const tw = Date.now();
while (!(await page.$(".transit-banner.arrived, .claim-ready")) && Date.now() - tw < 8 * 60 * 1000) await sleep(2000); // a long waitForSelector hits the protocol timeout
log(`arrival after ${Math.round((Date.now() - tw) / 1000)} s of waiting`);
await page.goto(`${BASE}/play/journey`, { waitUntil: "networkidle0" });
await page.waitForSelector("button::-p-text(Claim your caravan)", { timeout: 20000 });
await shot("arrived");
await click("button::-p-text(Claim your caravan)");
await page.waitForSelector("dialog[open]", { timeout: 15000 });
log("result:", await page.$eval("dialog[open] .sheet-title", (e) => e.textContent));
await shot("result");
log("balance after claim:", await balance());
const toMarket = await page.$("dialog[open] a::-p-text(Go to the market)");
if (toMarket) await toMarket.click(); else await page.keyboard.press("Escape");
await sleep(1000);

// sell
if (!(await page.$(".goods"))) { await navTab("Market"); }
await page.waitForSelector(".goods");
await sleep(600);
await click(`button[aria-label="Sell ${good}"]`);
await page.waitForSelector("dialog[open] .cost");
await shot("sell-sheet");
log("sell preview:", await page.$eval("dialog[open] .cost", (e) => e.textContent));
await click("dialog[open] .sheet-foot button::-p-text(Sell for)");
await page.waitForSelector(".toast", { timeout: 10000 });
log("sell toast:", await page.$$eval(".toast", (els) => els.map((e) => e.className.replace("toast ", "") + ": " + e.textContent).join(" || ")));
await sleep(1500);
log("final balance:", await balance());
await shot("after-sell");

// ranks and cash
await navTab("Ranks");
await page.waitForSelector(".table", { timeout: 10000 });
await sleep(800);
await shot("ranks", true); await overflow("ranks");
log("ranks:", (await page.$$eval(".table tbody tr", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim()))).join(" | "));
await navTab("Cash");
await page.waitForSelector(".balance-card");
await shot("cash", true); await overflow("cash");

// logout
await click("header button::-p-text(Menu)");
await shot("menu");
await click("dialog[open] button::-p-text(Log out)");
await page.waitForSelector("input.input", { timeout: 15000 });
log("logout -> login form shown again");
await shot("logged-out");
log("errors:", errors.length ? "\n  " + errors.join("\n  ") : "none");
await browser.close();
