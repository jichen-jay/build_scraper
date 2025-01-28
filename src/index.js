import { chromium } from "playwright-core";
import path from "path";
import os from "os";
import express from "express";
import fs from "fs";
import createCompress from "compress-brotli";
import compression from 'compression';
const { compress } = createCompress();

import { minify } from "html-minifier-terser";
import { sanitizePageContent } from "./contentSanitizer.js";
import { removeScrollBlockers } from "./scrollBlockerRemover.js";

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
      viewport: { width: 412, height: 915 },
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

      document.querySelectorAll("picture").forEach((picture) => {
        const sources = Array.from(picture.querySelectorAll("source"));
        const img = picture.querySelector("img");

        if (sources.length > 0) {
          const smallestSource = sources.reduce((acc, curr) => {
            const width = parseInt(
              curr.getAttribute("data-width") ||
                curr.getAttribute("width") ||
                Infinity
            );
            return !acc || width < acc.width ? { element: curr, width } : acc;
          }, null);

          if (smallestSource) {
            img.src = smallestSource.element.srcset.split(" ")[0];
            sources.forEach((source) => {
              if (source !== smallestSource.element) source.remove();
            });
          }
        }
      });

      // Handle standalone <img> tags with srcset
      document.querySelectorAll("img[srcset]").forEach((img) => {
        const srcset = img.getAttribute("srcset");
        const sources = srcset.split(",").map((s) => {
          const [url, size] = s.trim().split(" ");
          return { url, size: parseInt(size) };
        });

        const smallestSource = sources.reduce((acc, curr) => {
          return !acc || curr.size < acc.size ? curr : acc;
        }, null);

        if (smallestSource) {
          img.src = smallestSource.url;
          img.removeAttribute("srcset");
        }
      });
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

  const app = express();
  const PORT = 5000;
  app.use(compression({
    level: 6, // compression level
    filter: (req, res) => {
      return compression.filter(req, res);
    }
  }));

  app.get("/", async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send('Error: Missing "url" query parameter.');
    }

    try {
      const returnedContent = await openOneTab(targetUrl);
      const acceptEncoding = req.headers["accept-encoding"] || "";
      if (acceptEncoding.includes("br")) {
        console.log(`browser accept br encoding`);
        res.set({
          "Content-Encoding": "br",
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          Vary: "Accept-Encoding",
          "Content-Length": returnedContent.length,
        });
      }

      res.send(returnedContent);
    } catch (error) {
      console.error(error);
      res.status(500).send("Error processing the webpage.");
    }
  });

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });

  process.on("SIGINT", async () => {
    console.log("\nClosing browser...");
    await browser.close();
    process.exit(0);
  });
})();
