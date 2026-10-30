/* eslint-disable no-console */
// Walks the whole mock loop in headless Chrome and saves screenshots at 390 and 1280 px.
// Usage (dev server on NEXT_PUBLIC_MOCK=1 running):
//   node apps/web/src/ui/shoot/shoot.mjs [baseUrl] [outDir]
// Needs a local Chrome (CHROME_PATH or the usual Windows locations). The clock of the page is skewed
// with a Date.now override so the 3 to 6 minute journey can be finished in seconds.

import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3107";
const OUT = resolve(process.argv[3] ?? "docs/screens");
mkdirSync(OUT, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome found; set CHROME_PATH");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function run(width, height, tag) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  await page.evaluateOnNewDocument(() => {
    const real = Date.now.bind(Date);
    window.__skew = 0;
    Date.now = () => real() + window.__skew * 1000;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  const shot = async (name, full = true) => {
    await sleep(350);
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png`, fullPage: full });
  };
  const click = async (sel) => {
    const el = await page.waitForSelector(sel, { visible: true, timeout: 8000 });
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await el.click();
  };
  const overflow = async (name) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    log(`  [${tag}] ${name}: scrollWidth ${o.sw} / viewport ${o.iw} ${o.sw > o.iw ? "OVERFLOW" : "ok"}`);
  };
  const navTab = async (label) => {
    const ok = await page.evaluate((l) => {
      const el = [...document.querySelectorAll("a.tab, a.navlink")].find((a) => a.textContent.trim() === l && a.offsetParent !== null);
      if (el) el.click();
      return !!el;
    }, label);
    if (!ok) throw new Error(`nav tab ${label} not found`);
    await sleep(500);
  };
  const balance = async () => page.$eval(".topbar .balance .num", (e) => e.textContent).catch(() => "?");

  // ---- sign in and onboarding
  await page.goto(`${BASE}/play`, { waitUntil: "networkidle0" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle0" });
  await shot("01-login", false);
  const t0 = Date.now();
  await click("button::-p-text(Continue with Google)");
  await page.waitForSelector(".onboarding");
  await shot("02-onboarding-1", false);
  await click("button::-p-text(Next)");
  await click("button::-p-text(Next)");
  await shot("03-onboarding-3", false);
  await click("button::-p-text(Start trading)");
  await page.waitForSelector(".mapcanvas");
  await sleep(500);
  await shot("04-map");
  await overflow("map");
  log(`  [${tag}] start balance ${await balance()}`);

  // ---- market in Bandar, buy the cheapest-looking good that sells higher elsewhere
  await click("a::-p-text(Open Bandar market)");
  await page.waitForSelector(".goods");
  await shot("05-market");
  await overflow("market");
  const buyGood = process.env.BUY_GOOD ?? "Spice";
  await click(`button[aria-label="Buy ${buyGood}"]`);
  await page.waitForSelector("dialog[open] .cost");
  await shot("06-trade-sheet", false);
  const cost = await page.$eval("dialog[open] .cost", (e) => e.textContent);
  log(`  [${tag}] buy preview: ${cost}`);
  await click("dialog[open] .sheet-foot button::-p-text(Buy for)");
  await page.waitForSelector(".toast-success");
  await shot("07-after-buy", false);
  log(`  [${tag}] after buy: ${await balance()}`);

  // ---- plan and start the journey
  await click("a::-p-text(Plan a journey)");
  await page.waitForSelector(".planner");
  await sleep(500);
  await shot("08-journey-planner");
  await overflow("planner");
  const dest = await page.$eval(".dest.on .strong", (e) => e.textContent).catch(() => "?");
  await click("button::-p-text(Send caravan to)");
  await page.waitForSelector(".transit");
  const secs = Math.round((Date.now() - t0) / 1000);
  log(`  [${tag}] login -> caravan sent to ${dest} in ${secs}s of wall time`);
  await shot("09-in-transit");
  await overflow("transit");
  await navTab("Map");
  await page.waitForSelector(".caravan-marker");
  await shot("10-map-caravan");

  // ---- fast-forward the clock, claim, result
  await page.evaluate(() => { window.__skew = 400; });
  await page.waitForSelector(".transit-banner.arrived", { timeout: 15000 });
  await click("a.transit-banner");
  await page.waitForSelector("button::-p-text(Claim your caravan)");
  await sleep(800);
  await shot("11-arrived", false);
  await click("button::-p-text(Claim your caravan)");
  await page.waitForSelector("dialog[open]");
  await shot("12-result", false);
  const result = await page.$eval("dialog[open] .sheet-title", (e) => e.textContent);
  log(`  [${tag}] result: ${result}`);

  // ---- sell
  await click("dialog[open] a::-p-text(Go to the market)");
  await page.waitForSelector(".goods");
  await sleep(600);
  const sellBtn = `button[aria-label="Sell ${buyGood}"]`;
  await click(sellBtn);
  await page.waitForSelector("dialog[open] .cost");
  await shot("13-sell-sheet", false);
  const sellCost = await page.$eval("dialog[open] .cost", (e) => e.textContent);
  log(`  [${tag}] sell preview: ${sellCost}`);
  await click("dialog[open] .sheet-foot button::-p-text(Sell for)");
  await page.waitForSelector(".toast");
  const toast = await page.$eval(".toast", (e) => e.className + ": " + e.textContent);
  log(`  [${tag}] sell toast: ${toast}`);
  await shot("14-after-sell", false);
  log(`  [${tag}] final balance ${await balance()}`);

  // ---- merchant mind
  await click("button::-p-text(Why this price?)");
  await page.waitForSelector("dialog[open] .decision", { timeout: 8000 }).catch(async (e) => {
    await page.screenshot({ path: `${OUT}/debug-${tag}.png` });
    throw e;
  });
  await shot("15-merchant-mind", false);
  const badge = await page.$eval("dialog[open] .badge", (e) => e.textContent).catch(() => "none");
  log(`  [${tag}] mind badge: ${badge}`);
  await page.keyboard.press("Escape");
  await sleep(300);
  await click("header button::-p-text(Menu)");
  await shot("15a-menu", false);
  await click("dialog[open] button::-p-text(Golnar)");
  await page.waitForSelector("dialog[open] .decision");
  await shot("15b-merchant-mind-evidence", false);
  log(`  [${tag}] dasht mind badge: ${await page.$eval("dialog[open] .badge", (e) => e.textContent).catch(() => "none")}`);
  await page.keyboard.press("Escape");
  await sleep(300);

  // ---- other screens (client-side navigation keeps the in-memory mock world)
  const nav = navTab;
  await nav("Cash");
  await page.waitForSelector(".balance-card");
  await shot("16-cash");
  await overflow("cash");
  await click("button::-p-text(Advanced)");
  await page.waitForSelector("dialog[open]");
  await shot("17-advanced", false);
  await page.keyboard.press("Escape");
  await nav("Ranks");
  await page.waitForSelector(".table");
  await shot("18-ranks");
  await overflow("ranks");

  // ---- LIVE cash preview with canned data
  await page.goto(`${BASE}/play/cash?live=1`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#dep-amount");
  await shot("19-cash-live-deposit");
  await overflow("cash live");
  await page.type("#dep-amount", "5");
  await page.type("#dep-refund", "alice.near");
  await click("button::-p-text(Get deposit address)");
  await page.waitForSelector(".deposit-grid");
  await shot("20-deposit-waiting");
  await sleep(10000);
  await shot("21-deposit-processing");
  await sleep(9000);
  await shot("22-deposit-credited");
  await page.goto(`${BASE}/play/proof/dasht`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".raw");
  await shot("23-proof");

  log(`  [${tag}] page errors: ${errors.length ? "\n    " + errors.join("\n    ") : "none"}`);
  await browser.close();
}

const only = process.env.ONLY;
if (!only || only === "390") await run(390, 844, "390");
if (!only || only === "1280") await run(1280, 800, "1280");
if (!only || only === "360") await run(360, 780, "360");
