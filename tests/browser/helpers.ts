import type { Locator, Page } from "@playwright/test";

export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

export function fitsViewport(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
}

export function imageLoaded(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (element) =>
      element instanceof HTMLImageElement &&
      element.complete &&
      element.naturalWidth > 0,
  );
}
