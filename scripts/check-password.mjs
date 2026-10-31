import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (err) => problems.push(String(err)));

async function login(username, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.locator('form:has(input[name="username"]) button[type="submit"]').click();
  await page.waitForTimeout(1800);
  return page.url();
}

async function changePassword(current, next) {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.fill('input[name="currentPassword"]', current);
  await page.fill('input[name="newPassword"]', next);
  await page.fill('input[name="confirmPassword"]', next);
  await page.locator('button:has-text("修改密码")').click();
  await page.waitForTimeout(2200);
  return page.url();
}

console.log("login:", await login("doctor", "doctor1234"));
const afterChange = await changePassword("doctor1234", "doctor12345");
console.log("after change ->", afterChange);
console.log("login with new:", await login("doctor", "doctor12345"));
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.screenshot({ path: "D:\\zhongyiqianduan\\screenshots\\100-s1-password-changed.png" });
const restore = await changePassword("doctor12345", "doctor1234");
console.log("restore ->", restore);
console.log("login with original:", await login("doctor", "doctor1234"));
console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 5).join("\n") : "none");
await browser.close();
