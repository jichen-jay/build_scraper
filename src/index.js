import { chromium } from "playwright-core";
import path from "path";
import os from "os";
import express from "express";
import fs from "fs";

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
      bypassCSP: true
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

    await page.addInitScript(() => {
      const metaTags = document.querySelectorAll(
        'meta[http-equiv="Content-Security-Policy"]'
      );
      metaTags.forEach((meta) => meta.remove());
      console.log("Removed CSP meta tags.");
    });

    await page.goto(validUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await page.evaluate(() => {
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        const policy = window.trustedTypes.createPolicy('default', {
          createHTML: string => string,
          createScriptURL: string => string,
          createScript: string => string
        });
        return policy;
      }
    });
    
    // await page.addScriptTag({
    //   content: yourScript,
    //   type: 'module'
    // });
    
    
    // Remove blocking elements and guard dog scripts
    // await page.evaluate(() => {
    //   document.querySelectorAll("script").forEach((script) => {
    //     if (
    //       script.src.includes("csp") ||
    //       script.src.includes("guarddog") ||
    //       script.src.includes("security")
    //     ) {
    //       console.log(`Removing suspected guard dog script: ${script.src}`);
    //       script.remove();
    //     }
    //   });

    //   document
    //     .querySelectorAll("[class*='modal'], [class*='overlay'], [class*='ad']")
    //     .forEach((el) => el.remove());
    // });

    // const purifyContent = fs.readFileSync("./src/purify.min.js", "utf8");
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

    await page.evaluate((domainToUse) => {
      const cleanupSelectors = [
        "script",
        "noscript",
        "iframe",
        "style:not([data-essential])",
        '[class*="tracking"]',
        '[class*="analytics"]',

        // Interactive elements
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="overlay"]',
        '[class*="drawer"]',
        '[class*="dialog"]',
        ".tp-modal",
        ".tp-backdrop",
        ".tp-please-wait",

        // Social/Sharing
        '[class*="share"]',
        '[class*="social"]',

        // Comments and related content
        '[class*="comment"]',
        '[class*="related"]',
        '[class*="recommendation"]',

        // Ads and newsletters
        '[class*="newsletter"]',
        '[class*="ad-"]',
        '[class*="advertisement"]',
      ];

      cleanupSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => el.remove());
      });

      const mainContent =
        document.querySelector("article") || document.querySelector(".content");
      if (mainContent) {
        mainContent.style.cssText = `
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 18px;
          line-height: 1.6;
          color: #222;
          background: #fff;
        `;
      }

      if (window.DOMPurify) {
        DOMPurify.addHook("beforeSanitizeElements", (node) => {
          if (node && node.tagName) {
            console.log(`[DOMPurify Debug] Before sanitizing: ${node.tagName}`);
          }
          return node;
        });

        DOMPurify.addHook("uponSanitizeElement", (node, data) => {
          if (data && data.tagName) {
            console.log(`[DOMPurify Debug] Processing: ${data.tagName}`);
          }
          if (data.tagName === "a") {
            console.log("<a> tag found, checking attributes...");
            const href = node.getAttribute("href");
            if (href) {
              const parsedHref = new URL(href, domainToUse);
              if (parsedHref.protocol === "javascript:") {
                console.log(
                  "[Node Debug] JavaScript link detected, removing..."
                );
                node.remove();
                return;
              }

              console.log(`[Node Debug] Original href: ${href}`);
              console.log(`[Node Debug] Parsed URL: ${parsedHref.toString()}`);

              if (!parsedHref.href.includes("localhost:5000")) {
                const newHref = `http://localhost:5000/?url=${encodeURIComponent(
                  parsedHref.href
                )}`;
                console.log(`[Node Debug] Modified URL: ${newHref}`);
                node.setAttribute("href", newHref);
              }

              node.setAttribute("target", "_blank");
              node.setAttribute("rel", "noopener noreferrer");
            }

            if (
              node.children &&
              node.children.length === 0 &&
              !node.textContent.trim() &&
              !["IMG", "SOURCE"].includes(node.tagName)
            ) {
              console.log(`Removing empty element: ${data.tagName}`);
              node.remove();
            }
          }
        });

        // NEW: Enhanced DOMPurify config
        const purifyConfig = {
          ADD_TAGS: [
            "main",
            "article",
            "section",
            "figure",
            "figcaption",
            "img",
            "p",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "a",
            "ul",
            "li",
            "ol",
            "table",
            "tr",
            "td",
            "th",
          ],
          FORBID_TAGS: [
            "script",
            "style",
            "iframe",
            "frame",
            "embed",
            "object",
            "param",
            "form",
            "input",
            "textarea",
            "button",
            "select",
            "option",
            "nav",
            "aside",
            "footer",
            "header",
          ],
          ALLOWED_ATTR: [
            "src",
            "alt",
            "href",
            "target",
            "rel",
            "title",
            "width",
            "height",
          ],
          FORBID_ATTR: [
            "onclick",
            "onload",
            "onerror",
            "onmouseover",
            "onmouseout",
            "onkeydown",
            "onkeyup",
            "data-src",
            "data-srcset",
            "loading",
            "role",
          ],
          KEEP_CONTENT: true,
          WHOLE_DOCUMENT: true,
          SANITIZE_DOM: true,
          ALLOW_DATA_ATTR: false,
          RETURN_TRUSTED_TYPE: true,
        };

        const cleanHTML = DOMPurify.sanitize(
          document.documentElement.innerHTML,
          purifyConfig
        );
        document.documentElement.innerHTML = cleanHTML;

        // NEW: Final cleanup after sanitization
        document.querySelectorAll("*").forEach((el) => {
          if (
            el.children.length === 0 &&
            !el.textContent.trim() &&
            !["IMG", "SOURCE", "BR", "HR"].includes(el.tagName)
          ) {
            el.remove();
          }

          if (el !== mainContent) {
            el.removeAttribute("style");
          }
        });

        const anch = document.querySelectorAll("a");
        console.log("Anchors after second pass:", anch.length);
      }
    }, originalDomain);

    await page.evaluate(() => {
      const purifierScript = document.querySelector(
        'script[src*="purify.min.js"]'
      );
      if (purifierScript) purifierScript.remove();

      const scrollBlockingSelectors = [
        ".sp-message-open",
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="overlay"]',
        '[class*="dialog"]',
        ".o-header__drawer",
        ".o-header__mega",
        ".o-header__search",
        ".typeahead__main-container",
      ];

      // Remove classes and reset styles for each matching element
      scrollBlockingSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
          // Remove scroll blocking classes
          element.classList.remove("sp-message-open");
          element.removeAttribute("aria-hidden");
          element.removeAttribute("aria-expanded");

          // Reset scroll blocking styles
          element.style.cssText = `
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            width: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            top: auto !important;
            left: auto !important;
            right: auto !important;
            bottom: auto !important;
            transform: none !important;
            pointer-events: auto !important;
            display: block !important;
          `;
        });
      });

      // Reset html and body
      [document.documentElement, document.body].forEach((elem) => {
        elem.style.cssText = `
          overflow: visible !important;
          overflow-x: visible !important;
          overflow-y: visible !important;
          position: static !important;
          height: auto !important;
          width: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          pointer-events: auto !important;
        `;
      });

      // Enable pointer events and interactions
      document.querySelectorAll("*").forEach((elem) => {
        elem.style.pointerEvents = "auto";
        elem.style.cursor =
          elem.tagName.toLowerCase() === "a" ||
          elem.tagName.toLowerCase() === "button"
            ? "pointer"
            : "auto";
      });

      // Enable specific interactive elements
      document
        .querySelectorAll('a, button, input, select, [role="button"]')
        .forEach((elem) => {
          elem.style.pointerEvents = "auto";
          elem.style.cursor = "pointer";
          elem.removeAttribute("disabled");
          elem.removeAttribute("aria-disabled");
          elem.setAttribute("tabindex", "0");
        });

      // Fix specific menu/navigation elements
      document
        .querySelectorAll(".o-header__nav-link, .o-header__top-link-label")
        .forEach((elem) => {
          elem.style.pointerEvents = "auto";
          elem.style.cursor = "pointer";
          elem.removeAttribute("aria-hidden");
        });

      // Enable click events on containers
      document
        .querySelectorAll(
          ".story-group, .story-group__article, .primary-story__teaser"
        )
        .forEach((elem) => {
          elem.style.pointerEvents = "auto";
        });
    });

    // Get the sanitized HTML content
    const sanitizedHTML = await page.content();
    return sanitizedHTML;
  } finally {
    await page.close();
  }
}

(async () => {
  await initializeBrowser();

  const app = express();
  const PORT = 5000;

  app.get("/", async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
      return res.status(400).send('Error: Missing "url" query parameter.');
    }

    try {
      const returnedContent = await openOneTab(targetUrl);
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
