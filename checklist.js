// checklist.js — orchestrates scanning, rendering, saving, and offline sync.
import { fetchChecklist, saveChecklistDiff } from "./firebase.js";
import { startScanner, stopScanner } from "./scanner.js";

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const scanScreen = $("scan-screen");
const clScreen = $("checklist-screen");
const btnStart = $("btn-start");
const btnStop = $("btn-stop");
const btnBack = $("btn-back");
const btnSave = $("btn-save");
const reader = $("reader");
const clTitle = $("cl-title");
const clBarcode = $("cl-barcode");
const clItems = $("cl-items");
const clProgress = $("cl-progress");
const loader = $("loader");
const toast = $("toast");
const netBadge = $("net-badge");

// ---------- State ----------
let currentBarcode = null;
let currentData = null;      // { title, items: { id: { text, done } } }
let pendingChanges = {};     // { id: boolean } — only diffs
const LS_LAST = (b) => `fc:last:${b}`;
const LS_QUEUE = "fc:queue";

// ---------- UI helpers ----------
function showLoader(on) { loader.hidden = !on; }
function showToast(msg, kind = "") {
  toast.textContent = msg;
  toast.className = "toast" + (kind ? " " + kind : "");
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toast.hidden = true), 2200);
}
function showScreen(which) {
  scanScreen.hidden = which !== "scan";
  clScreen.hidden = which !== "checklist";
}
function updateNetBadge() {
  netBadge.hidden = navigator.onLine;
}

// ---------- Scanning ----------
btnStart.addEventListener("click", async () => {
  try {
    reader.hidden = false;
    btnStart.hidden = true;
    btnStop.hidden = false;
    await startScanner("reader", handleScan);
  } catch (e) {
    console.error(e);
    showToast("تعذر تشغيل الكاميرا", "error");
    resetScanUI();
  }
}, { passive: true });

btnStop.addEventListener("click", async () => {
  await stopScanner();
  resetScanUI();
}, { passive: true });

function resetScanUI() {
  reader.hidden = true;
  btnStart.hidden = false;
  btnStop.hidden = true;
}

async function handleScan(code) {
  await stopScanner();
  resetScanUI();
  await openChecklist(code);
}

// ---------- Checklist load / render ----------
async function openChecklist(barcode) {
  currentBarcode = barcode;
  pendingChanges = {};
  showLoader(true);

  // 1) Instant render from cache if available (offline-first UX)
  const cached = readCache(barcode);
  if (cached) {
    currentData = cached;
    renderChecklist();
    showScreen("checklist");
  }

  // 2) Try network fetch
  try {
    if (navigator.onLine) {
      const data = await fetchChecklist(barcode);
      if (data) {
        currentData = normalize(data);
        writeCache(barcode, currentData);
        renderChecklist();
        showScreen("checklist");
      } else if (!cached) {
        showToast("لا يوجد Checklist لهذا الباركود", "error");
        showScreen("scan");
      }
    } else if (!cached) {
      showToast("غير متصل ولا توجد نسخة محفوظة", "error");
      showScreen("scan");
    }
  } catch (e) {
    console.error(e);
    if (!cached) {
      showToast("فشل الجلب من الخادم", "error");
      showScreen("scan");
    }
  } finally {
    showLoader(false);
  }
}

function normalize(data) {
  // Ensure items is an object keyed by id
  const items = {};
  if (Array.isArray(data.items)) {
    data.items.forEach((it, i) => {
      const id = it.id ?? String(i);
      items[id] = { text: it.text ?? String(it), done: !!it.done };
    });
  } else if (data.items && typeof data.items === "object") {
    for (const [id, v] of Object.entries(data.items)) {
      items[id] = { text: v.text ?? String(v), done: !!v.done };
    }
  }
  return { title: data.title || "Checklist", items };
}

function renderChecklist() {
  clTitle.textContent = currentData.title;
  clBarcode.textContent = currentBarcode;

  const frag = document.createDocumentFragment();
  const entries = Object.entries(currentData.items);
  for (const [id, item] of entries) {
    const li = document.createElement("li");
    li.className = "item" + (item.done ? " done" : "");
    li.dataset.id = id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!item.done;
    cb.id = `it-${id}`;

    const lbl = document.createElement("label");
    lbl.htmlFor = cb.id;
    lbl.textContent = item.text;

    li.append(cb, lbl);
    frag.append(li);
  }
  clItems.replaceChildren(frag);
  updateProgress();
}

function updateProgress() {
  const entries = Object.values(currentData.items);
  const done = entries.filter((i) => i.done).length;
  clProgress.textContent = `${done} / ${entries.length}`;
}

// Event delegation — one listener for all checkboxes
clItems.addEventListener("change", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  const li = target.closest(".item");
  if (!li) return;
  const id = li.dataset.id;
  const done = target.checked;
  currentData.items[id].done = done;
  pendingChanges[id] = done;
  li.classList.toggle("done", done);
  updateProgress();
});

// ---------- Save ----------
btnSave.addEventListener("click", async () => {
  if (!currentBarcode || Object.keys(pendingChanges).length === 0) {
    showToast("لا توجد تغييرات");
    return;
  }
  showLoader(true);
  try {
    if (navigator.onLine) {
      await saveChecklistDiff(currentBarcode, pendingChanges);
      showToast("تم الحفظ", "success");
    } else {
      queueChanges(currentBarcode, pendingChanges);
      showToast("محفوظ محلياً — سيُزامن عند الاتصال", "success");
    }
    writeCache(currentBarcode, currentData);
    pendingChanges = {};
  } catch (e) {
    console.error(e);
    queueChanges(currentBarcode, pendingChanges);
    showToast("فشل الحفظ — تم وضعه في قائمة الانتظار", "error");
  } finally {
    showLoader(false);
  }
});

btnBack.addEventListener("click", () => {
  currentBarcode = null;
  currentData = null;
  pendingChanges = {};
  showScreen("scan");
});

// ---------- Offline cache & queue ----------
function readCache(barcode) {
  try { return JSON.parse(localStorage.getItem(LS_LAST(barcode)) || "null"); }
  catch { return null; }
}
function writeCache(barcode, data) {
  try { localStorage.setItem(LS_LAST(barcode), JSON.stringify(data)); } catch { /* ignore */ }
}
function queueChanges(barcode, changes) {
  const queue = JSON.parse(localStorage.getItem(LS_QUEUE) || "{}");
  queue[barcode] = { ...(queue[barcode] || {}), ...changes };
  localStorage.setItem(LS_QUEUE, JSON.stringify(queue));
}
async function flushQueue() {
  const raw = localStorage.getItem(LS_QUEUE);
  if (!raw) return;
  const queue = JSON.parse(raw);
  const barcodes = Object.keys(queue);
  if (barcodes.length === 0) return;
  for (const bc of barcodes) {
    try {
      await saveChecklistDiff(bc, queue[bc]);
      delete queue[bc];
    } catch (e) {
      console.warn("sync failed for", bc, e);
    }
  }
  localStorage.setItem(LS_QUEUE, JSON.stringify(queue));
  if (Object.keys(queue).length === 0) showToast("تمت المزامنة", "success");
}

window.addEventListener("online", () => { updateNetBadge(); flushQueue(); });
window.addEventListener("offline", updateNetBadge);
updateNetBadge();
if (navigator.onLine) flushQueue();

// Initial screen
showScreen("scan");
