// Preflight (once): npm run test:ui:personal:install
// Run explicitly: npm run test:ui:personal
// The default `npm test` deliberately does not launch or install Chromium.

import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  installPersonalAssistantFixture,
  setFixtureMode,
  type FixtureAudit,
} from "./fixture";

let audit: FixtureAudit | undefined;

test.beforeEach(async ({ page }) => {
  audit = await installPersonalAssistantFixture(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForFunction(() => {
    const fixture = (window as Window & { __jarvisTest?: { receivedState: number } }).__jarvisTest;
    return Boolean(fixture?.receivedState);
  });
});

test.afterEach(() => {
  expect(audit?.pageErrors ?? []).toEqual([]);
  expect(audit?.externalRequests ?? []).toEqual([]);
  audit = undefined;
});

async function clickSidebarAction(page: Page, selector: string) {
  const target = page.locator(selector);
  const targetBox = await target.boundingBox();
  const viewport = page.viewportSize();
  const targetIsInViewport = Boolean(targetBox && viewport
    && targetBox.x + targetBox.width > 0
    && targetBox.y + targetBox.height > 0
    && targetBox.x < viewport.width
    && targetBox.y < viewport.height);
  if (!targetIsInViewport) {
    await page.locator("#menuBtn").click();
    await expect.poll(async () => {
      const box = await target.boundingBox();
      return Boolean(box && viewport && box.x + box.width > 0 && box.x < viewport.width);
    }).toBe(true);
  }
  await target.click();
  return target;
}

async function openPersonalAssistant(page: Page) {
  const trigger = await clickSidebarAction(page, "#personalBtn");
  await expect(page.locator("#personalModal")).toBeVisible();
  await expect(page.locator("#personalQuery")).toBeFocused();
  return trigger;
}

async function openAssistantSettings(page: Page) {
  await clickSidebarAction(page, "#settingsBtn");
  await expect(page.locator("#settings")).toBeVisible();
  const compactSection = page.locator("#setSection");
  if (await compactSection.isVisible()) await compactSection.selectOption("assistente");
  else await page.locator('.snav[data-goto="assistente"]').click();
  await expect(page.locator('.spanel[data-panel="assistente"]')).toBeVisible();
}

async function openDataSettings(page: Page) {
  await clickSidebarAction(page, "#settingsBtn");
  await expect(page.locator("#settings")).toBeVisible();
  const compactSection = page.locator("#setSection");
  if (await compactSection.isVisible()) await compactSection.selectOption("dados");
  else await page.locator('.snav[data-goto="dados"]').click();
  await expect(page.locator('.spanel[data-panel="dados"]')).toBeVisible();
}

async function openSourceSettings(page: Page) {
  await clickSidebarAction(page, "#settingsBtn");
  await expect(page.locator("#settings")).toBeVisible();
  const compactSection = page.locator("#setSection");
  if (await compactSection.isVisible()) await compactSection.selectOption("fontes");
  else await page.locator('.snav[data-goto="fontes"]').click();
  await expect(page.locator('.spanel[data-panel="fontes"]')).toBeVisible();
}

async function expectNoOverflowOrControlOverlap(page: Page, modalSelector: string) {
  const issues = await page.locator(modalSelector).evaluate((modal) => {
    const problems: string[] = [];
    const viewport = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const card = modal.querySelector(":scope > .card") as HTMLElement | null;
    const cardRect = card?.getBoundingClientRect();
    if (!cardRect) return ["missing modal card"];

    if (document.documentElement.scrollWidth > viewport.width + 1) {
      problems.push(`document horizontal overflow: ${document.documentElement.scrollWidth} > ${viewport.width}`);
    }
    if (cardRect.left < -1 || cardRect.right > viewport.width + 1) {
      problems.push(`card horizontal bounds: ${cardRect.left}..${cardRect.right} / ${viewport.width}`);
    }
    if (cardRect.top < -1 || cardRect.bottom > viewport.height + 1) {
      problems.push(`card vertical bounds: ${cardRect.top}..${cardRect.bottom} / ${viewport.height}`);
    }
    if (card && card.scrollWidth > card.clientWidth + 1) {
      problems.push(`card horizontal overflow: ${card.scrollWidth} > ${card.clientWidth}`);
    }

    const controls = Array.from(modal.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],details>summary"))
      .filter((element) => !element.closest(".maplibregl-control-container"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        if (rect.width < 1 || rect.height < 1) return false;
        const x = Math.max(0, Math.min(viewport.width - 1, rect.left + rect.width / 2));
        const y = Math.max(0, Math.min(viewport.height - 1, rect.top + rect.height / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === element || element.contains(hit)));
      });

    const insideHorizontalScroller = (element: HTMLElement) => {
      let node: HTMLElement | null = element.parentElement;
      while (node && node !== card && node !== modal) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };

    for (const { element, rect } of controls) {
      // Controls inside an intentional horizontal scroller (e.g. the settings tab strip) are
      // expected to extend past the card edge and be clipped/scrolled, not "escape".
      if (!insideHorizontalScroller(element) && (rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1)) {
        problems.push(`${element.id || element.tagName} escapes card horizontally`);
      }
      if (element.scrollWidth > element.clientWidth + 2 && !["SELECT", "INPUT", "TEXTAREA"].includes(element.tagName)) {
        problems.push(`${element.id || element.tagName} clips its content`);
      }
    }

    for (let left = 0; left < controls.length; left += 1) {
      for (let right = left + 1; right < controls.length; right += 1) {
        const a = controls[left];
        const b = controls[right];
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          problems.push(`${a.element.id || a.element.tagName} overlaps ${b.element.id || b.element.tagName}`);
        }
      }
    }
    return problems;
  });
  expect(issues).toEqual([]);
}

async function runQuery(page: Page, mode: "results" | "empty" | "error", text: string) {
  await setFixtureMode(page, mode);
  await page.locator("#personalPurpose").selectOption("events");
  await page.locator("#personalQuery").fill(text);
  await page.locator("#personalRun").click();
  await expect(page.locator("#personalQueryStatus")).not.toHaveText(/Consultando/);
}

async function screenshotPixelStats(page: Page, target: Locator) {
  const screenshot = await target.screenshot({ animations: "disabled" });
  const source = `data:image/png;base64,${screenshot.toString("base64")}`;
  return page.evaluate(async (imageSource) => {
    const image = new Image();
    image.src = imageSource;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas unavailable for screenshot assertion");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Set<string>();
    let blue = 0;
    let green = 0;
    let yellow = 0;
    let coloredMinX = canvas.width;
    let coloredMinY = canvas.height;
    let coloredMaxX = -1;
    let coloredMaxY = -1;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (offset % 64 === 0) buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}:${alpha >> 6}`);
      const routeBlue = alpha > 180 && b > 170 && b - r > 55 && b - g > 25;
      const markerGreen = alpha > 180 && g > 130 && g - r > 35 && g - b > 20;
      const originYellow = alpha > 180 && r > 180 && g > 130 && b < 120;
      if (!routeBlue && !markerGreen && !originYellow) continue;
      if (routeBlue) blue += 1;
      if (markerGreen) green += 1;
      if (originYellow) yellow += 1;
      const pixelIndex = offset / 4;
      const x = pixelIndex % canvas.width;
      const y = Math.floor(pixelIndex / canvas.width);
      coloredMinX = Math.min(coloredMinX, x);
      coloredMinY = Math.min(coloredMinY, y);
      coloredMaxX = Math.max(coloredMaxX, x);
      coloredMaxY = Math.max(coloredMaxY, y);
    }
    return {
      blue,
      green,
      yellow,
      uniqueColorBuckets: buckets.size,
      width: canvas.width,
      height: canvas.height,
      coloredBounds: { minX: coloredMinX, minY: coloredMinY, maxX: coloredMaxX, maxY: coloredMaxY },
    };
  }, source);
}

test("modal focus, Escape restoration, and contextual help", async ({ page }) => {
  const trigger = await openPersonalAssistant(page);
  await page.locator("#personalViewMap").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#personalClose")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#personalViewMap")).toBeFocused();
  await expectNoOverflowOrControlOverlap(page, "#personalModal");

  await page.keyboard.press("Escape");
  await expect(page.locator("#personalModal")).toBeHidden();
  await expect(trigger).toBeFocused();

  await openAssistantSettings(page);
  await page.locator("#settingsHelpBtn").click();
  await expect(page.locator("#helpSheet")).toBeVisible();
  await expect(page.locator("#helpSheetTitle")).toContainText("Assistente pessoal");
  await expect(page.locator("#helpSheetBody")).toContainText("Ativar assistente pessoal");
  await expect(page.locator("#helpSheetBody")).toContainText("O que acontece com esse dado");
  await expectNoOverflowOrControlOverlap(page, "#helpSheet");
  await expect(page).toHaveScreenshot("assistant-help.png");
  await page.locator("#helpSheetClose").click();
  await expect(page.locator("#helpSheet")).toBeHidden();
});

test("empty and source-error states remain readable", async ({ page }) => {
  await openPersonalAssistant(page);

  await runQuery(page, "empty", "eventos sem correspondencia");
  await expect(page.locator("#personalResults")).toContainText("Nenhum resultado encontrado");
  await expect(page.locator("#personalDiagnostics")).toBeVisible();
  await expectNoOverflowOrControlOverlap(page, "#personalModal");
  await expect(page).toHaveScreenshot("assistant-empty.png");

  await runQuery(page, "error", "fonte temporariamente indisponivel");
  await expect(page.locator("#personalResults")).toContainText("Fonte oficial indisponivel (fixture offline).");
  await expect(page.locator("#personalQueryStatus")).toContainText(/1 fonte\(s\) indispon.vel\(is\)\./);
  await expect(page.locator("#personalDiagnostics")).toBeHidden();
  await expectNoOverflowOrControlOverlap(page, "#personalModal");
  await expect(page).toHaveScreenshot("assistant-error.png");
});

test("data summary resolves sourceIds to source labels", async ({ page }) => {
  await openDataSettings(page);
  const category = page.locator(".personal-data-category", { hasText: "Observações" });
  await expect(category).toBeVisible();
  await expect(category).toContainText("Mapa Cultural BH (fixture)");
  await expect(category).not.toContainText("Não informado");
  await expect(category).toHaveScreenshot("assistant-data-source-ids.png");
});

test("source center exposes device freshness and pauses one source without revoking consent", async ({ page }) => {
  await openSourceSettings(page);
  const calendar = page.locator("#personalSourceList .personal-row", { hasText: "Agenda deste aparelho" });
  await expect(calendar).toContainText("Sincronização necessária");
  await expect(calendar).toContainText("última atualização");

  const location = page.locator("#personalSourceList .personal-row", { hasText: "Localização deste aparelho" });
  await expect(location).toContainText("Sincronizado");

  const events = page.locator("#personalSourceList .personal-row", { hasText: "Mapa Cultural BH (fixture)" });
  await events.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(events).toContainText("Pausada");
  await expect(events.getByRole("button", { name: "Retomar", exact: true })).toBeVisible();
  await expect(events.getByRole("button", { name: "Revogar", exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { sent: Array<Record<string, unknown>> } }).__jarvisTest;
    const frame = fixture?.sent.findLast((item) => item.t === "personal_context_update");
    return frame && (frame.patch as { pausedSourceIds?: string[] }).pausedSourceIds;
  })).toEqual(["mapas-culturais-fixture"]);
  await events.scrollIntoViewIfNeeded();
  await expectNoOverflowOrControlOverlap(page, "#settings");
});

test("CalDAV discovery keeps the editor open and supports multiple calendar selection", async ({ page }) => {
  await openSourceSettings(page);
  const source = page.locator("#personalSourceList .personal-row", { hasText: "Equipe CalDAV (fixture)" });
  await source.getByRole("button", { name: "Descobrir", exact: true }).click();
  const discovery = page.locator("#personalSourceDiscovery");
  await expect(discovery).toBeVisible();
  await expect(discovery).toContainText("Capacidades descobertas");
  await expect(discovery).toContainText("Pronta · Saudável · 42 ms");
  await expect(page.locator("#personalSourceType")).toHaveValue("caldav");

  const team = discovery.getByRole("checkbox", { name: "Agendas: Equipe" });
  const personal = discovery.getByRole("checkbox", { name: "Agendas: Pessoal" });
  await expect(team).toBeChecked();
  await expect(personal).not.toBeChecked();
  await personal.check();
  await expect(page.locator("#personalSourceResources")).toHaveValue("https://calendar.invalid/team/, https://calendar.invalid/personal/");
  await team.uncheck();
  await expect(page.locator("#personalSourceResources")).toHaveValue("https://calendar.invalid/personal/");
  await expect(discovery).toBeVisible();
  await expect(page.locator("#settings .settings-head")).toBeInViewport();
  await expect(page.locator("#settings .settings-actions")).toBeInViewport();
  await expectNoOverflowOrControlOverlap(page, "#settings");
  await expect(page).toHaveScreenshot("assistant-source-discovery.png");
});

test("query revision is used by the next personal edit", async ({ page }) => {
  await openPersonalAssistant(page);
  await runQuery(page, "results", "festival com revisao atualizada");
  const result = page.locator(".personal-result", { hasText: "Festival de Luzes - fixture" });
  await result.getByRole("button", { name: "Gostei", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { sent: Array<Record<string, unknown>> } }).__jarvisTest;
    return fixture?.sent.findLast((frame) => frame.t === "personal_feedback_put")?.revision;
  })).toBe(8);
  await expect(page.locator("#personalModal")).toBeVisible();
});

test("navigation ACK deadline becomes a localized uncertain state", async ({ page }) => {
  await openPersonalAssistant(page);
  await runQuery(page, "results", "festival com handoff sem resposta");
  const result = page.locator(".personal-result", { hasText: "Festival de Luzes - fixture" });
  await result.getByRole("button", { name: "Abrir rota", exact: true }).click();
  await expect(page.locator("#personalActionModal")).toBeVisible();
  await page.locator("#personalActionExecute").click();

  const actionState = page.locator("#personalActionState");
  await expect(actionState).toContainText("Resultado externo incerto", { timeout: 5_000 });
  await expect(actionState).toContainText("A confirmação da abertura não chegou dentro do prazo.");
  await expect(actionState).not.toContainText("client handoff acknowledgement timed out");
  await expect(page.locator("#personalActionModal")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { popup?: { href: string } } }).__jarvisTest;
    return fixture?.popup?.href;
  })).toMatch(/^geo:/);
  await expect.poll(async () => page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { sent: Array<Record<string, unknown>> } }).__jarvisTest;
    const frame = fixture?.sent.find((item) => item.t === "personal_action_handoff_result");
    return frame && { keys: Object.keys(frame).sort(), success: frame.success };
  })).toEqual({ keys: ["planId", "requestId", "success", "t"], success: true });
});

test("blocked navigation popup never executes the action", async ({ page }) => {
  await openPersonalAssistant(page);
  await runQuery(page, "results", "festival com popup bloqueado");
  const result = page.locator(".personal-result", { hasText: "Festival de Luzes - fixture" });
  await result.getByRole("button", { name: "Abrir rota", exact: true }).click();
  await page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { popupBlocked: boolean } }).__jarvisTest;
    if (fixture) fixture.popupBlocked = true;
  });
  await page.locator("#personalActionExecute").click();
  await expect(page.locator("#personalActionState")).toContainText("O navegador bloqueou a nova janela.");
  const sentTypes = await page.evaluate(() => {
    const fixture = (window as Window & { __jarvisTest?: { sent: Array<Record<string, unknown>> } }).__jarvisTest;
    return fixture?.sent.map((frame) => frame.t) || [];
  });
  expect(sentTypes).not.toContain("personal_action_execute");
  expect(sentTypes).not.toContain("personal_action_handoff_result");
  await expect(page.locator("#personalActionModal")).toBeVisible();
});

test("event provenance, action modal, and fitted route render offline", async ({ page }) => {
  await openPersonalAssistant(page);
  await runQuery(page, "results", "festival com rota local");

  const result = page.locator(".personal-result", { hasText: "Festival de Luzes - fixture" });
  await expect(result).toBeVisible();
  await expect(result).toContainText("fonte oficial confirmada");
  await expect(result).toContainText("festival cultural");
  await expect(result).toContainText("rota 1,5 km");
  await expect(result).not.toContainText("linha reta 1,1 km");
  await expect(result).toContainText("confiança 91%");
  await expect(result).toContainText("recente");
  await expect(result).toContainText("observado");
  const source = result.getByRole("link", { name: "Mapa Cultural BH (fixture)" });
  await expect(source).toHaveAttribute("href", "https://events.invalid/festival-luzes");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  await expectNoOverflowOrControlOverlap(page, "#personalModal");
  await expect(page).toHaveScreenshot("assistant-results-list.png");

  const actionTrigger = result.getByRole("button", { name: "Revisar na agenda" });
  await actionTrigger.click();
  await expect(page.locator("#personalActionModal")).toBeVisible();
  await expect(page.locator("#personalActionClose")).toBeFocused();
  await expect(page.locator("#personalActionTitle")).toHaveText("Adicionar festival a agenda");
  await expectNoOverflowOrControlOverlap(page, "#personalActionModal");
  await expect(page).toHaveScreenshot("assistant-action.png");
  await page.keyboard.press("Escape");
  await expect(page.locator("#personalActionModal")).toBeHidden();
  await expect(actionTrigger).toBeFocused();

  await page.locator("#personalViewMap").click();
  const map = page.locator("#personalMap");
  const canvas = map.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await expect(map.locator(".personal-map-empty")).toHaveCount(0);
  await expect.poll(async () => (await screenshotPixelStats(page, map)).blue).toBeGreaterThan(40);
  const pixels = await screenshotPixelStats(page, map);
  expect(pixels.green).toBeGreaterThan(20);
  expect(pixels.yellow).toBeGreaterThan(20);
  expect(pixels.uniqueColorBuckets).toBeGreaterThan(8);
  await expect(map.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap contributors");
  expect(pixels.coloredBounds.minX).toBeGreaterThan(10);
  expect(pixels.coloredBounds.minY).toBeGreaterThan(10);
  expect(pixels.coloredBounds.maxX).toBeLessThan(pixels.width - 10);
  expect(pixels.coloredBounds.maxY).toBeLessThan(pixels.height - 10);
  await expectNoOverflowOrControlOverlap(page, "#personalModal");
  await expect(page).toHaveScreenshot("assistant-results-map.png");
});
