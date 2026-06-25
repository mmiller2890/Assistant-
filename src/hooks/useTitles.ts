import { useEffect } from "react";

/**
 * Hook to conditionally render titles based on user preference.
 * Titles are disabled in this fork; this hook strips them once on mount
 * and re-scans on idle to catch dynamically-added elements without
 * keeping a permanent whole-document MutationObserver running.
 * @param titleText The title text to render if enabled
 * @returns The title text if enabled, empty string if disabled
 */
export const useTitles = () => {
  const getTitle = (): string => {
    return "";
  };

  const removeTitleFromElement = (element: Element) => {
    const currentTitle = element.getAttribute("title");
    if (currentTitle) {
      element.setAttribute("data-original-title", currentTitle);
      element.removeAttribute("title");
    }
  };

  const disableTitles = () => {
    const rootElement = document.documentElement;
    const allElementsWithTitles = document.querySelectorAll("[title]");

    rootElement?.setAttribute("data-titles-disabled", "true");
    rootElement?.removeAttribute("data-titles-enabled");

    allElementsWithTitles.forEach((element) => {
      removeTitleFromElement(element);
    });
  };

  // Handle title visibility globally. Titles are always disabled here, so we
  // only do an initial pass and a low-frequency idle re-scan instead of a
  // permanent whole-document MutationObserver.
  useEffect(() => {
    const timeoutId = setTimeout(disableTitles, 100);

    let idleId: number | null = null;
    const scheduleIdleScan = () => {
      if (idleId !== null) return;
      idleId = window.setTimeout(() => {
        idleId = null;
        disableTitles();
      }, 1000);
    };

    // Re-scan when the DOM changes, debounced via idle scheduling.
    const observer = new MutationObserver(() => {
      scheduleIdleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      clearTimeout(timeoutId);
      if (idleId !== null) clearTimeout(idleId);
      observer.disconnect();
    };
  }, []);

  return {
    getTitle,
    isTitlesEnabled: false,
  };
};