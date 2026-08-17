"use strict";
(() => {
  // src/content/capture.ts
  var session = null;
  function scroller() {
    return document.scrollingElement ?? document.documentElement;
  }
  function collectOverlays() {
    const out = [];
    const all = document.querySelectorAll("body *");
    const limit = 3e4;
    let i = 0;
    for (const el of all) {
      if (++i > limit) break;
      const pos = getComputedStyle(el).position;
      if (pos === "fixed" || pos === "sticky") {
        out.push({ el, originalStyleAttr: el.getAttribute("style") });
      }
    }
    return out;
  }
  function nextFrame() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function waitForViewportImages(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (; ; ) {
      const pending = [];
      for (const img of document.images) {
        const rect = img.getBoundingClientRect();
        const inView = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        if (inView && img.src && !img.complete) pending.push(img);
      }
      if (pending.length === 0 || Date.now() > deadline) return;
      await Promise.race([
        Promise.all(
          pending.map(
            (img) => new Promise((r) => {
              img.addEventListener("load", () => r(), { once: true });
              img.addEventListener("error", () => r(), { once: true });
            })
          )
        ),
        sleep(Math.max(50, deadline - Date.now()))
      ]);
      await nextFrame();
    }
  }
  function metrics() {
    const sc = scroller();
    return {
      pageWidth: sc.scrollWidth,
      pageHeight: sc.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      title: document.title,
      url: location.href
    };
  }
  function handleInit(captureDelayMs) {
    if (session) return metrics();
    const sc = scroller();
    session = {
      overlays: collectOverlays(),
      overlaysHidden: false,
      htmlStyleAttr: document.documentElement.getAttribute("style"),
      bodyStyleAttr: document.body.getAttribute("style"),
      scrollX: sc.scrollLeft,
      scrollY: sc.scrollTop,
      helperStyle: null,
      captureDelayMs
    };
    window.__fullpagedActive = true;
    const style = document.createElement("style");
    style.textContent = "html, body { scroll-behavior: auto !important; } html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }";
    document.documentElement.appendChild(style);
    session.helperStyle = style;
    return metrics();
  }
  function hideOverlays() {
    if (!session || session.overlaysHidden) return;
    for (const { el } of session.overlays) {
      el.style.setProperty("visibility", "hidden", "important");
    }
    session.overlaysHidden = true;
  }
  async function handleScroll(x, y, hide) {
    if (!session) throw new Error("capture session not initialized");
    if (hide) hideOverlays();
    const sc = scroller();
    sc.scrollLeft = x;
    sc.scrollTop = y;
    await nextFrame();
    await waitForViewportImages(1500);
    if (session.captureDelayMs > 0) await sleep(session.captureDelayMs);
    await nextFrame();
    return { x: sc.scrollLeft, y: sc.scrollTop };
  }
  function restoreStyleAttr(el, value) {
    if (value === null) el.removeAttribute("style");
    else el.setAttribute("style", value);
  }
  async function handleCleanup() {
    if (session) {
      const { overlays, htmlStyleAttr, bodyStyleAttr, helperStyle, scrollX, scrollY } = session;
      session = null;
      for (const { el, originalStyleAttr } of overlays) restoreStyleAttr(el, originalStyleAttr);
      restoreStyleAttr(document.documentElement, htmlStyleAttr);
      restoreStyleAttr(document.body, bodyStyleAttr);
      helperStyle?.remove();
      const sc = scroller();
      sc.scrollLeft = scrollX;
      sc.scrollTop = scrollY;
      await nextFrame();
      for (const { el, originalStyleAttr } of overlays) {
        if (el.getAttribute("style") !== originalStyleAttr) restoreStyleAttr(el, originalStyleAttr);
      }
    }
    window.__fullpagedActive = false;
    return { ok: true };
  }
  if (!globalThis.__fullpagedListener) {
    globalThis.__fullpagedListener = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      (async () => {
        switch (msg.type) {
          case "fp:init":
            return handleInit(msg.captureDelayMs);
          case "fp:scroll":
            return handleScroll(msg.x, msg.y, msg.hideOverlays);
          case "fp:cleanup":
            return handleCleanup();
        }
      })().then(sendResponse, (err) => sendResponse({ error: String(err) }));
      return true;
    });
  }
})();
