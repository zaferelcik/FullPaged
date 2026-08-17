"use strict";
(() => {
  // src/lib/types.ts
  var DEFAULT_SETTINGS = {
    format: "png",
    jpegQuality: 0.92,
    filenameTemplate: "{domain}_{date}_{time}",
    captureDelayMs: 0
  };
  var MAX_SEGMENT_HEIGHT = 16384;
  var CAPTURE_MIN_INTERVAL_MS = 600;

  // src/lib/settings.ts
  async function loadSettings() {
    const stored = await chrome.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...stored.settings ?? {} };
  }

  // src/lib/idb.ts
  var DB_NAME = "fullpaged";
  var STORE = "captures";
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "meta.id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function putCapture(capture) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(capture);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  async function getCapture(id) {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  }
  async function pruneCaptures(maxAgeMs) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const cutoff = Date.now() - maxAgeMs;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const value = cursor.value;
        if (value.meta.createdAt < cutoff) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  // src/background/index.ts
  var state = {
    running: false,
    done: 0,
    total: 0,
    error: null,
    quotaRetries: 0
  };
  var RESTRICTED_PREFIXES = [
    "chrome://",
    "chrome-extension://",
    "devtools://",
    "about:",
    "edge://",
    "view-source:",
    "chrome-untrusted://",
    "https://chromewebstore.google.com",
    "https://chrome.google.com/webstore"
  ];
  var RESTRICTED_MESSAGE = "Chrome does not allow extensions to capture this page (browser pages, the Web Store and other extensions are off-limits). Try it on a regular website.";
  function restrictedReason(url) {
    if (!url) return RESTRICTED_MESSAGE;
    if (RESTRICTED_PREFIXES.some((p) => url.startsWith(p))) {
      return RESTRICTED_MESSAGE;
    }
    if (url.startsWith("file://")) {
      return 'To capture local files, enable "Allow access to file URLs" for FullPaged in chrome://extensions.';
    }
    return null;
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  var lastShotAt = 0;
  async function shoot(windowId) {
    const wait = lastShotAt + CAPTURE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 0; ; attempt++) {
      lastShotAt = Date.now();
      try {
        return await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND") && attempt < 8) {
          state.quotaRetries++;
          await sleep(500);
          continue;
        }
        throw err;
      }
    }
  }
  function dataUrlToBitmap(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: "image/png" }));
  }
  var SegmentedCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      let y = 0;
      while (y < height) {
        const h = Math.min(MAX_SEGMENT_HEIGHT, height - y);
        this.starts.push(y);
        this.segmentHeights.push(h);
        this.canvases.push(new OffscreenCanvas(width, h));
        y += h;
      }
    }
    segmentHeights = [];
    canvases = [];
    starts = [];
    draw(bmp, dx, dy) {
      for (let i = 0; i < this.canvases.length; i++) {
        const start = this.starts[i];
        const end = start + this.segmentHeights[i];
        if (dy + bmp.height <= start || dy >= end) continue;
        const ctx = this.canvases[i].getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bmp, dx, dy - start);
      }
    }
    async toBlobs() {
      const out = [];
      for (const c of this.canvases) out.push(await c.convertToBlob({ type: "image/png" }));
      this.canvases = [];
      return out;
    }
  };
  function sendToTab(tabId, msg) {
    return chrome.tabs.sendMessage(tabId, msg);
  }
  function buildPositions(page, viewport) {
    if (page <= viewport) return [0];
    const out = [];
    for (let pos = 0; pos < page - viewport; pos += viewport) out.push(pos);
    out.push(page - viewport);
    return out;
  }
  function broadcastState() {
    chrome.runtime.sendMessage({ type: "capture-progress", state: { ...state } }).catch(() => {
    });
  }
  async function runCapture(tab) {
    const reason = restrictedReason(tab.url);
    if (reason) return { ok: false, error: reason, quotaRetries: 0 };
    const tabId = tab.id;
    if (tabId === void 0) return { ok: false, error: "No active tab.", quotaRetries: 0 };
    const settings = await loadSettings();
    state.running = true;
    state.done = 0;
    state.total = 0;
    state.error = null;
    state.quotaRetries = 0;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      const metrics = await sendToTab(tabId, {
        type: "fp:init",
        captureDelayMs: settings.captureDelayMs
      });
      await sendToTab(tabId, {
        type: "fp:scroll",
        x: 0,
        y: metrics.pageHeight,
        hideOverlays: false
      });
      const settled = await sendToTab(tabId, {
        type: "fp:init",
        captureDelayMs: settings.captureDelayMs
      });
      const page = settled;
      const ys = buildPositions(page.pageHeight, page.viewportHeight);
      const xs = buildPositions(page.pageWidth, page.viewportWidth);
      state.total = ys.length * xs.length;
      broadcastState();
      let canvas = null;
      let scale = 0;
      for (let yi = 0; yi < ys.length; yi++) {
        for (let xi = 0; xi < xs.length; xi++) {
          const first = yi === 0 && xi === 0;
          const pos = await sendToTab(tabId, {
            type: "fp:scroll",
            x: xs[xi],
            y: ys[yi],
            hideOverlays: !first
          });
          const dataUrl = await shoot(tab.windowId);
          const bmp = await dataUrlToBitmap(dataUrl);
          if (!canvas) {
            scale = bmp.width / page.viewportWidth;
            canvas = new SegmentedCanvas(
              Math.round(page.pageWidth * scale),
              Math.round(page.pageHeight * scale)
            );
          }
          canvas.draw(bmp, Math.round(pos.x * scale), Math.round(pos.y * scale));
          bmp.close();
          state.done++;
          broadcastState();
        }
      }
      await sendToTab(tabId, { type: "fp:cleanup" });
      if (!canvas) throw new Error("nothing captured");
      const id = crypto.randomUUID();
      const meta = {
        id,
        createdAt: Date.now(),
        scale,
        width: canvas.width,
        height: canvas.height,
        segmentHeights: canvas.segmentHeights,
        page: {
          title: page.title,
          url: page.url,
          domain: safeDomain(page.url)
        }
      };
      const segments = await canvas.toBlobs();
      globalThis.__fpLastCanvasRef = new WeakRef(canvas);
      canvas = null;
      await pruneCaptures(24 * 60 * 60 * 1e3);
      await putCapture({ meta, segments });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`preview.html?id=${id}`) });
      return { ok: true, id, quotaRetries: state.quotaRetries };
    } catch (err) {
      try {
        await sendToTab(tabId, { type: "fp:cleanup" });
      } catch {
      }
      state.error = String(err instanceof Error ? err.message : err);
      return { ok: false, error: state.error, quotaRetries: state.quotaRetries };
    } finally {
      state.running = false;
      broadcastState();
    }
  }
  function safeDomain(url) {
    try {
      return new URL(url).hostname || "page";
    } catch {
      return "page";
    }
  }
  async function captureActiveTab() {
    if (state.running) return { ok: false, error: "A capture is already running.", quotaRetries: 0 };
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) return { ok: false, error: "No active tab.", quotaRetries: 0 };
    return runCapture(tab);
  }
  chrome.commands.onCommand.addListener((command) => {
    if (command === "capture") void captureActiveTab();
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "capture-start":
        captureActiveTab().then(sendResponse);
        return true;
      case "capture-state":
        sendResponse({ ...state });
        return false;
      case "preview-meta":
        getCapture(msg.id).then((c) => sendResponse(c ? c.meta : null));
        return true;
    }
    return false;
  });
  globalThis.__fpCaptureActiveTab = captureActiveTab;
  globalThis.__fpState = state;
  globalThis.__fpRestrictedReason = restrictedReason;
})();
