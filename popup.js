"use strict";
(() => {
  // src/popup/index.ts
  var btn = document.getElementById("capture");
  var status = document.getElementById("status");
  var bar = document.getElementById("bar");
  var barFill = document.getElementById("barfill");
  function showProgress(s) {
    if (s.running) {
      btn.disabled = true;
      bar.style.display = "block";
      status.className = "";
      status.textContent = s.total > 0 ? `Capturing\u2026 ${s.done}/${s.total}` : "Capturing\u2026";
      barFill.style.width = s.total > 0 ? `${Math.round(100 * s.done / s.total)}%` : "5%";
    }
  }
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.className = "";
    status.textContent = "Capturing\u2026";
    bar.style.display = "block";
    const result = await chrome.runtime.sendMessage({ type: "capture-start" });
    if (result?.ok) {
      status.textContent = "Done \u2014 opening preview\u2026";
      window.close();
    } else {
      btn.disabled = false;
      bar.style.display = "none";
      status.className = "error";
      status.textContent = result?.error ?? "Capture failed.";
    }
  });
  document.getElementById("options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "capture-progress") showProgress(msg.state);
  });
  chrome.runtime.sendMessage({ type: "capture-state" }).then((s) => {
    if (s?.running) showProgress(s);
  }).catch(() => {
  });
  chrome.commands.getAll().then((commands) => {
    const cmd = commands.find((c) => c.name === "capture");
    const el = document.getElementById("shortcut");
    if (cmd?.shortcut && el) el.textContent = cmd.shortcut;
  });
})();
