// scrollBlockerRemover.js
export async function removeScrollBlockers(page) {
    await page.evaluate(() => {
      // Remove the purifier script if it exists
      const purifierScript = document.querySelector('script[src*="purify.min.js"]');
      if (purifierScript) purifierScript.remove();
  
      // Selectors for elements that block scrolling
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
          // Remove scroll-blocking classes
          element.classList.remove("sp-message-open");
          element.removeAttribute("aria-hidden");
          element.removeAttribute("aria-expanded");
  
          // Reset scroll-blocking styles
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
  
      // Reset styles for html and body
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
  
      // Enable pointer events and interactions for all elements
      document.querySelectorAll("*").forEach((elem) => {
        elem.style.pointerEvents = "auto";
        elem.style.cursor =
          elem.tagName.toLowerCase() === "a" || elem.tagName.toLowerCase() === "button"
            ? "pointer"
            : "auto";
      });
  
      // Enable specific interactive elements
      document.querySelectorAll('a, button, input, select, [role="button"]').forEach((elem) => {
        elem.style.pointerEvents = "auto";
        elem.style.cursor = "pointer";
        elem.removeAttribute("disabled");
        elem.removeAttribute("aria-disabled");
        elem.setAttribute("tabindex", "0");
      });
  
      // Fix specific menu/navigation elements
      document.querySelectorAll(".o-header__nav-link, .o-header__top-link-label").forEach((elem) => {
        elem.style.pointerEvents = "auto";
        elem.style.cursor = "pointer";
        elem.removeAttribute("aria-hidden");
      });
  
      // Enable click events on containers
      document.querySelectorAll(".story-group, .story-group__article, .primary-story__teaser").forEach((elem) => {
        elem.style.pointerEvents = "auto";
      });
    });
  }
  