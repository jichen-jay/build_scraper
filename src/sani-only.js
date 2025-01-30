import { chromium } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";
import Fastify from "fastify";
import fastifyCompress from "@fastify/compress";
import { minify } from "html-minifier-terser";
import { sanitizePageContent } from "./sanitize-less.js";
import { removeScrollBlockers } from "./scrollBlockerRemover.js";

const fastify = Fastify({
  logger: true,
  connectionTimeout: 30000,
  keepAliveTimeout: 30000,
});

await fastify.register(fastifyCompress, {
  encodings: ["br", "gzip"],
  brotli: {
    quality: 4,
    lgwin: 22,
  },
  threshold: 1024,
});

const purifyContent = `${fs.readFileSync("./src/purify.min.js", "utf8")}`;
let browser;

async function initializeBrowser() {
  try {
    const userDataDir = path.join(os.homedir(), ".playwright-chromium-data");
    const mobile_user_agent =
      "Mozilla/5.0 (Linux; Android 14; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    browser = await chromium.launchPersistentContext(userDataDir, {
      executablePath: process.env.CHROMIUM_PATH,
      channel: "chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--disable-extensions",
        "--disable-popup-blocking",
        "--disable-notifications",
      ],
      userAgent: mobile_user_agent,
      ignoreDefaultArgs: ["--enable-automation"],
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    });

    await browser.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    if (fs.existsSync(path.join(userDataDir, "Default", "SingletonLock"))) {
      fs.unlinkSync(path.join(userDataDir, "Default", "SingletonLock"));
    }
  } catch (error) {
    console.error("Failed to launch the browser:", error);
    process.exit(1);
  }
}

async function validateAndParseUrl(inputUrl) {
  try {
    const parsedUrl = new URL(
      inputUrl.startsWith("http") ? inputUrl : `https://${inputUrl}`
    );
    return parsedUrl.href;
  } catch {
    throw new Error("Invalid URL format");
  }
}

var rawSize;

async function openOneTab(targetUrl) {
  const page = await browser.newPage();
  console.log(`Opening page: ${targetUrl}`);

  page.on("console", async (msg) => {
    console.log(`[Browser Console] ${msg.text()}`);
  });

  try {
    const validUrl = await validateAndParseUrl(targetUrl);
    console.log(`Validated URL: ${validUrl}`);
    const originalDomain = new URL(validUrl).origin;

    await page.goto(validUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const htmlContent = await page.content();

    rawSize = Buffer.byteLength(htmlContent, "utf8");

    await page.evaluate(() => {
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        const policy = window.trustedTypes.createPolicy("default", {
          createHTML: (string) => string,
          createScriptURL: (string) => string,
          createScript: (string) => string,
        });
        return policy;
      }
    });

    await page.addScriptTag({
      content: purifyContent,
      type: "module",
    });

    await page.evaluate(() => {
      if (window.DOMPurify) {
        document
          .querySelectorAll(
            'script[src], link[rel="preload"], #gateway-content'
          )
          .forEach((el) => el.remove());
      }
    });

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await sanitizePageContent(page, originalDomain);

    await removeScrollBlockers(page);

    console.log(`more than ${rawSize} bytes downloaded`);

    const sanitizedHTML = await page.content();

    let size = Buffer.byteLength(sanitizedHTML, "utf8");

    console.log(`Sanitized content size before compression: ${size} bytes`);

    if (!sanitizedHTML.includes("<html")) {
      sanitizedHTML = `<html><head></head><body>${sanitizedHTML}</body></html>`;
    }

    const minifiedHTML = await minify(sanitizedHTML, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
    });

    console.log(
      `Minified HTML size: ${Buffer.byteLength(minifiedHTML, "utf8")} bytes`
    );

    return minifiedHTML;
  } finally {
    await page.close();
  }
}

(async () => {
  await initializeBrowser();
  fastify.get("/", async (request, reply) => {
    const targetUrl = request.query.url;

    if (!targetUrl) {
      reply.code(400).send('Error: Missing "url" query parameter.');
      return;
    }

    try {
      const content = await openOneTab(targetUrl);

      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive");

      return content;
    } catch (error) {
      request.log.error(error);
      reply.code(500).send("Error processing the webpage.");
    }
  });

  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(500).send({ error: "Internal Server Error" });
  });

  const start = async () => {
    try {
      await fastify.listen({
        port: 5000,
        host: "0.0.0.0", // Listen on all network interfaces
      });
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  process.on("SIGINT", async () => {
    console.log("\nInitiating graceful shutdown...");
    try {
      await browser.close();
      await fastify.close();
      console.log("Server closed successfully");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  });

  start();
})();
