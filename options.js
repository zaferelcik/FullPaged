"use strict";
(() => {
  // src/lib/types.ts
  var DEFAULT_SETTINGS = {
    format: "png",
    jpegQuality: 0.92,
    filenameTemplate: "{domain}_{date}_{time}",
    captureDelayMs: 0
  };

  // src/lib/settings.ts
  async function loadSettings() {
    const stored = await chrome.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...stored.settings ?? {} };
  }
  async function saveSettings(s) {
    await chrome.storage.local.set({ settings: s });
  }

  // src/lib/filename.ts
  function pad(n) {
    return n < 10 ? `0${n}` : String(n);
  }
  function sanitize(part) {
    return part.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page";
  }
  function buildFilename(template2, info, now = /* @__PURE__ */ new Date()) {
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = template2.replaceAll("{domain}", sanitize(info.domain)).replaceAll("{title}", sanitize(info.title)).replaceAll("{date}", date).replaceAll("{time}", time);
    return sanitize(name) === "" ? "fullpaged" : name.replace(/[\\/:*?"<>|]+/g, "-");
  }

  // src/options/index.ts
  var format = document.getElementById("format");
  var quality = document.getElementById("quality");
  var qualityValue = document.getElementById("qualityValue");
  var qualityRow = document.getElementById("qualityRow");
  var template = document.getElementById("template");
  var delay = document.getElementById("delay");
  var saved = document.getElementById("saved");
  var preview = document.getElementById("filenamePreview");
  var savedTimer;
  function currentSettings() {
    return {
      format: format.value,
      jpegQuality: Number(quality.value) / 100,
      filenameTemplate: template.value || "{domain}_{date}_{time}",
      captureDelayMs: Math.max(0, Math.min(5e3, Number(delay.value) || 0))
    };
  }
  function refreshUi() {
    qualityValue.textContent = `${quality.value}%`;
    qualityRow.classList.toggle("disabled", format.value !== "jpeg");
    preview.textContent = buildFilename(template.value || "{domain}_{date}_{time}", {
      domain: "example.com",
      title: "Example page"
    });
  }
  async function persist() {
    await saveSettings(currentSettings());
    refreshUi();
    saved.style.visibility = "visible";
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => saved.style.visibility = "hidden", 1200);
  }
  loadSettings().then((s) => {
    format.value = s.format;
    quality.value = String(Math.round(s.jpegQuality * 100));
    template.value = s.filenameTemplate;
    delay.value = String(s.captureDelayMs);
    refreshUi();
  });
  for (const el of [format, quality, template, delay]) {
    el.addEventListener("input", () => void persist());
    el.addEventListener("change", () => void persist());
  }
})();
