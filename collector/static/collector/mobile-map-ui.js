/*
  Mobile fullscreen map UI wrapper.

  Constraints:
  - Must not change existing application logic. This file only toggles CSS classes,
    repositions existing panels via CSS, and triggers existing button clicks.
*/

// Include phone landscape (e.g. iPhone Pro Max) while avoiding desktop windows.
// We gate on touch support in JS, and keep the CSS gated behind `body.mobile-map-view`.
const MAX_MOBILE_LONG_EDGE = 1024;
const MOBILE_WIDTH_QUERY = `(max-width: ${MAX_MOBILE_LONG_EDGE}px)`;

const PAGE_CAPTURE = "capture";
const PAGE_FLOWING = "flowing";
const PAGE_MYHUB = "myhub";
const PAGE_MANAGEMENT = "management";

let toolbarEl = null;
let moreCloseBtn = null;
let hasCaptureAutoOpenedSheet = false;

function isMobileNow() {
  if (typeof window === "undefined") return false;
  const w = Number(window.innerWidth) || 0;
  const h = Number(window.innerHeight) || 0;
  const longEdge = Math.max(w, h);

  const nav = typeof navigator !== "undefined" ? navigator : null;
  const touchPoints = nav && typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0;
  const hasTouch = touchPoints > 0 || ("ontouchstart" in window);

  const mqlWidth = typeof window.matchMedia === "function" ? window.matchMedia(MOBILE_WIDTH_QUERY) : null;
  const mqlCoarse = typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : null;
  const coarsePointer = !!(mqlCoarse && mqlCoarse.matches);
  const widthOk = !!(mqlWidth && mqlWidth.matches);

  return (hasTouch || coarsePointer) && widthOk && longEdge > 0 && longEdge <= MAX_MOBILE_LONG_EDGE;
}

function getPageId() {
  const body = typeof document !== "undefined" ? document.body : null;
  const raw = body && body.dataset ? body.dataset.mapPage : "";
  return String(raw).trim();
}

function getSheetElement(pageId) {
  if (pageId === PAGE_CAPTURE) return document.querySelector(".form-panel");
  if (pageId === PAGE_FLOWING) return document.querySelector(".flowing-panel");
  if (pageId === PAGE_MYHUB) return document.querySelector(".myhub-panel");
  return null;
}

function setSheetState(sheetEl, state) {
  if (!sheetEl) return;
  if (state !== "open" && state !== "collapsed") return;
  sheetEl.dataset.sheet = state;
}

function toggleSheet(sheetEl) {
  if (!sheetEl) return;
  const current = sheetEl.dataset.sheet || "open";
  setSheetState(sheetEl, current === "open" ? "collapsed" : "open");
}

function closeTransientOverlays() {
  document.body.classList.remove("mobile-tools-open");
  document.body.classList.remove("mobile-more-open");
}

function toggleToolsOverlay() {
  const next = !document.body.classList.contains("mobile-tools-open");
  document.body.classList.toggle("mobile-tools-open", next);
  if (next) {
    document.body.classList.remove("mobile-more-open");
  }
}

function toggleMoreOverlay() {
  const next = !document.body.classList.contains("mobile-more-open");
  document.body.classList.toggle("mobile-more-open", next);
  if (next) {
    document.body.classList.remove("mobile-tools-open");
  }
}

function ensureMoreCloseButton() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  if (moreCloseBtn && topbar.contains(moreCloseBtn)) return;

  moreCloseBtn = document.createElement("button");
  moreCloseBtn.type = "button";
  moreCloseBtn.className = "secondary mobile-more-close";
  moreCloseBtn.textContent = "Close";
  moreCloseBtn.addEventListener("click", () => {
    document.body.classList.remove("mobile-more-open");
  });

  topbar.insertBefore(moreCloseBtn, topbar.firstChild);
}

function clickIfPresent(selector) {
  const el = document.querySelector(selector);
  if (el && typeof el.click === "function") el.click();
}

function buildToolbarButtons(pageId) {
  const buttons = [];

  if (pageId === PAGE_CAPTURE) {
    buttons.push({ key: "sheet", label: "Form" });
    buttons.push({ key: "tools", label: "Tools" });
    buttons.push({ key: "more", label: "More" });
    if (document.getElementById("locateViaGpsBtn")) {
      buttons.push({ key: "locate", label: "Locate" });
    }
    return buttons;
  }

  if (pageId === PAGE_FLOWING) {
    buttons.push({ key: "sheet", label: "Count" });
    buttons.push({ key: "tools", label: "Tools" });
    buttons.push({ key: "more", label: "More" });
    return buttons;
  }

  if (pageId === PAGE_MYHUB) {
    buttons.push({ key: "sheet", label: "Ideas" });
    buttons.push({ key: "tools", label: "Tools" });
    buttons.push({ key: "more", label: "More" });
    if (document.getElementById("locateViaGpsBtn")) {
      buttons.push({ key: "locate", label: "Locate" });
    }
    return buttons;
  }

  if (pageId === PAGE_MANAGEMENT) {
    buttons.push({ key: "toggleView", label: "Map/List" });
    buttons.push({ key: "tools", label: "Tools" });
    buttons.push({ key: "more", label: "More" });
    return buttons;
  }

  return buttons;
}

function ensureToolbar(pageId) {
  if (!toolbarEl) {
    toolbarEl = document.createElement("div");
    toolbarEl.className = "mobile-field-toolbar";
    toolbarEl.setAttribute("role", "navigation");
    toolbarEl.setAttribute("aria-label", "Mobile map toolbar");
    document.body.appendChild(toolbarEl);
    document.body.classList.add("mobile-toolbar-present");
  }

  const model = buildToolbarButtons(pageId);
  toolbarEl.innerHTML = "";

  model.forEach((spec) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mobile-field-btn";
    btn.dataset.mmAction = spec.key;
    btn.textContent = spec.label;
    toolbarEl.appendChild(btn);
  });
}

function setManagementMobileView(view) {
  if (view !== "map" && view !== "list") return;

  document.body.dataset.mobileView = view;
  const mapOn = view === "map";
  document.body.classList.toggle("mobile-map-view", mapOn);

  if (!mapOn) {
    closeTransientOverlays();
  }
}

function initializePageMobileState(pageId) {
  // All map pages hide nav behind the More overlay on mobile (CSS gated by .map-page).
  ensureMoreCloseButton();
  ensureToolbar(pageId);

  if (pageId === PAGE_MANAGEMENT) {
    // List-first on mobile.
    setManagementMobileView("list");
    return;
  }

  // Capture / Flowing / MyHub default to fullscreen map view on mobile.
  document.body.classList.add("mobile-map-view");

  const sheet = getSheetElement(pageId);
  if (pageId === PAGE_CAPTURE) {
    setSheetState(sheet, "collapsed");
    hasCaptureAutoOpenedSheet = false;
  } else {
    // Flowing + MyHub: keep controls reachable by default.
    setSheetState(sheet, "open");
  }
}

function attachEventHandlers(pageId) {
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionNode = target.closest("[data-mm-action]");
    const action = actionNode && actionNode.dataset ? actionNode.dataset.mmAction || "" : "";
    if (!action) return;

    if (action === "sheet") {
      const sheet = getSheetElement(pageId);
      toggleSheet(sheet);
      return;
    }

    if (action === "tools") {
      toggleToolsOverlay();
      return;
    }

    if (action === "more") {
      toggleMoreOverlay();
      return;
    }

    if (action === "locate") {
      clickIfPresent("#locateViaGpsBtn");
      return;
    }

    if (action === "toggleView") {
      const current = document.body.dataset.mobileView || "list";
      setManagementMobileView(current === "map" ? "list" : "map");
      return;
    }
  });

  // Capture: auto-open the bottom sheet on the first tap inside the map.
  if (pageId === PAGE_CAPTURE) {
    const mapWrap = document.getElementById("mapWrap");
    if (mapWrap) {
      mapWrap.addEventListener("click", () => {
        if (!isMobileNow()) return;
        if (hasCaptureAutoOpenedSheet) return;
        const sheet = getSheetElement(pageId);
        if (!sheet) return;
        setSheetState(sheet, "open");
        hasCaptureAutoOpenedSheet = true;
      });
    }
  }
}

function teardownMobileUi() {
  document.body.classList.remove("mobile-map-view");
  document.body.classList.remove("mobile-tools-open");
  document.body.classList.remove("mobile-more-open");
  document.body.classList.remove("mobile-toolbar-present");
  delete document.body.dataset.mobileView;

  if (toolbarEl && toolbarEl.parentNode) {
    toolbarEl.parentNode.removeChild(toolbarEl);
  }
  toolbarEl = null;

  if (moreCloseBtn && moreCloseBtn.parentNode) {
    moreCloseBtn.parentNode.removeChild(moreCloseBtn);
  }
  moreCloseBtn = null;
}

function main() {
  const pageId = getPageId();
  if (!pageId) return;

  const boot = () => {
    if (!isMobileNow()) {
      teardownMobileUi();
      return;
    }

    initializePageMobileState(pageId);
  };

  attachEventHandlers(pageId);

  // Initial boot.
  boot();

  // React to viewport changes (rotation, split screen, etc).
  const onViewportChange = () => {
    window.requestAnimationFrame(boot);
  };

  if (typeof window.matchMedia === "function") {
    const mql = window.matchMedia(MOBILE_WIDTH_QUERY);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onViewportChange);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(onViewportChange);
    }
  }

  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("orientationchange", onViewportChange, { passive: true });
}

main();
