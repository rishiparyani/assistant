// Screenshots of the web build against the local test server (fake data only). Serves `dist`
// on a port and, because that origin isn't the server's, hands the session cookie and the
// server's origin to each request the way the phone app does. Usage:
//   node apps/mobile/test/web-shots.cjs <cookie> <outDir>
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const [, , cookie, out = "shots"] = process.argv;
const BASE = process.env.BASE ?? "http://localhost:8787";
const dist = path.join(__dirname, "..", "dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const server = http.createServer((req, res) => {
  const file = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const p = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    });
    // The page's origin isn't the server's here (the real website is served by the Worker, same
    // origin), so answer CORS for the test and send the cookie and origin the way the phone does.
    await ctx.route(`${BASE}/**`, async (route) => {
      const req = route.request();
      const cors = {
        "access-control-allow-origin": url,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "content-type, idempotency-key, cookie, origin",
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const res = await route.fetch({ headers: { ...req.headers(), cookie, origin: BASE } });
      const headers = { ...res.headers(), ...cors };
      delete headers["content-encoding"];
      delete headers["content-length"];
      return route.fulfill({ status: res.status(), headers, body: await res.body() });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${scheme}: ${e.message}`));
    await page.goto(url);
    await page.waitForSelector("text=Now", { timeout: 30000 });
    await sleep(1500);
    await page.screenshot({ path: `${out}/${scheme}-1-now.png` });
    const box = await page.getByRole("checkbox").first();
    if (await box.count()) {
      await box.click();
      await sleep(600);
      await page.screenshot({ path: `${out}/${scheme}-2-ticked.png` });
    }
    await page.getByRole("button", { name: "Ask Gigspree" }).click();
    await sleep(1200);
    await page.screenshot({ path: `${out}/${scheme}-3-chat.png` });
    await ctx.close();
  }
  await browser.close();
  server.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("ok", fs.readdirSync(out).join(" "));
})();
