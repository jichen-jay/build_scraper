// contentSanitizer.js
export async function sanitizePageContent(page, domainToUse) {
    await page.evaluate((domainToUse) => {
      const cleanupSelectors = [
        "script",
        "noscript",
        "iframe",
        "style:not([data-essential])",
        '[class*="tracking"]',
        '[class*="analytics"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="overlay"]',
        '[class*="drawer"]',
        '[class*="dialog"]',
        ".tp-modal",
        ".tp-backdrop",
        ".tp-please-wait",
        '[class*="share"]',
        '[class*="social"]',
        '[class*="comment"]',
        '[class*="related"]',
        '[class*="recommendation"]',
        '[class*="newsletter"]',
        '[class*="ad-"]',
        '[class*="advertisement"]'
      ];
  
      // Remove unwanted elements
      cleanupSelectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => el.remove());
      });
  
      // Style the main content
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
  
      // DOMPurify hooks and sanitization
      if (window.DOMPurify) {
        DOMPurify.addHook("beforeSanitizeElements", (node) => {
          if (node && node.tagName) {
            console.log(`[DOMPurify Debug] Before sanitizing: ${node.tagName}`);
          }
          return node;
        });
  
        DOMPurify.addHook("uponSanitizeElement", (node, data) => {
          if (data && data.tagName === "a") {
            const href = node.getAttribute("href");
            if (href) {
              const parsedHref = new URL(href, domainToUse);
              if (parsedHref.protocol === "javascript:") {
                console.log("[Node Debug] JavaScript link detected, removing...");
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
              node.children.length === 0 &&
              !node.textContent.trim() &&
              !["IMG", "SOURCE"].includes(node.tagName)
            ) {
              console.log(`Removing empty element: ${data.tagName}`);
              node.remove();
            }
          }
        });
  
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
            "th"
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
            "option"
          ],
          ALLOWED_ATTR: [
            "src",
            "alt",
            "href",
            "target",
            "rel",
            "title"
          ],
          FORBID_ATTR: ["onclick", "onload", "onerror"],
          KEEP_CONTENT: true,
          WHOLE_DOCUMENT: true,
          SANITIZE_DOM: true,
          ALLOW_DATA_ATTR: false,
          RETURN_TRUSTED_TYPE: true
        };
  
        const cleanHTML = DOMPurify.sanitize(
          document.documentElement.innerHTML,
          purifyConfig
        );
        document.documentElement.innerHTML = cleanHTML;
  
        // Final cleanup after sanitization
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
  
        const anchors = document.querySelectorAll("a");
        console.log("Anchors after second pass:", anchors.length);
      }
    }, domainToUse);
  }
  