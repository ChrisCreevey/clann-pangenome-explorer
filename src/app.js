// app.js — upload glue: File(s) → parse() → pangenome explorer.
//
// Pure client side. Files are read with FileReader; nothing leaves the browser.
// Adapted from clann-blast-explorer/src/app.js (RBH/FASTA/taxdump upload
// flows removed — not part of this tool; will be replaced by CoinFinder
// pair upload in a later phase).

import { parse, ColumnMappingNeeded } from "./parse/index.js";
import { assignFrequencyClasses, adjustThresholds } from "./analysis/frequency.js";
import { mountExplorer } from "./pangenome.js";
import { renderColumnMapping } from "./render/column-mapping.js";
import { decompressIfNeeded } from "./parse/compressed.js";
import { detectAnnotationWorkflow, applyWorkflowA, applyWorkflowB } from "./parse/annotation.js";
import { keywordTag, listUploadTag } from "./analysis/tags.js";
import { parseCoinfinderFile } from "./parse/coinfinder.js";
import { resolvePairs } from "./analysis/pairs.js";
import { runBusy } from "./render/busy.js";

const explorerEl = document.getElementById("explorer");
const columnMappingEl = document.getElementById("columnMapping");
const fileInput = document.getElementById("fileInput");
const empty = document.getElementById("empty");
const drop = document.getElementById("drop");
const errBox = document.getElementById("err");
const wrap = document.getElementById("wrap");
const hTitle = document.getElementById("hTitle");
const hMeta = document.getElementById("hMeta");
const datasetMeta = document.getElementById("datasetMeta");

let handle = null; // the live explorer instance, once a file is loaded
let currentData = null; // the loaded PangenomeData, mutated in place by annotation/tagging
let lastAnnotationText = null; // cached raw text, so "re-apply with these thresholds" doesn't need a re-upload
let lastAnnotationSourceKey = null; // the column re-apply updates in place, rather than adding a duplicate

function showError(msg) {
  errBox.textContent = msg;
  errBox.style.display = "block";
  clearTimeout(showError._t);
  showError._t = setTimeout(() => (errBox.style.display = "none"), 6000);
}

function loadData(data, name) {
  empty.style.display = "none";
  columnMappingEl.style.display = "none";
  explorerEl.style.display = "flex";
  explorerEl.style.flexDirection = "column";
  hTitle.textContent = name || "";
  hMeta.textContent = `${data.meta.genomeCount} genomes · ${data.meta.groupCount} groups · ${data.meta.format}`;
  datasetMeta.textContent = `${name}: ${data.meta.genomeCount} genomes, ${data.meta.groupCount} gene groups (${data.meta.format}).`;
  currentData = data;
  lastAnnotationText = null;
  lastAnnotationSourceKey = null;
  document.getElementById("annotationStatus").textContent = "No annotation file loaded.";
  document.getElementById("annotationConsensusControls").style.display = "none";
  document.getElementById("tagListStatus").textContent = "";
  document.getElementById("associatedStatus").textContent = "No associated-pairs file loaded.";
  document.getElementById("disassociatedStatus").textContent = "No disassociated-pairs file loaded.";
  writeThresholdInputs(data.meta.freqClassThresholds);
  if (handle) handle = handle.setData(data);
  else handle = mountExplorer(explorerEl, data);
}

/** Re-render the explorer in place after annotation/tagging mutates currentData (no new file). */
function refreshExplorer() {
  if (!handle) return;
  // Re-rendering the whole explorer can be non-trivial at large scale (heatmap
  // rasterisation, accumulation curves) — busy spinner for the duration.
  runBusy(() => { handle = handle.setData(currentData); });
}

function openText(text, name) {
  // Parsing + the initial render can both take real time at large scale
  // (measured several seconds at 10,000+ genomes) — busy spinner covers both,
  // deferred by a tick so the spinner actually paints before the blocking work.
  runBusy(() => {
    const data = parse(text, { filename: name }); // throws ColumnMappingNeeded or a parse error
    loadData(data, name);
  }).catch((err) => {
    if (err instanceof ColumnMappingNeeded) {
      showColumnMapping(err, text, name);
      return;
    }
    showError(`Couldn't parse ${name}: ${err && err.message ? err.message : err}`);
  });
}

function showColumnMapping(err, text, name) {
  empty.style.display = "none";
  explorerEl.style.display = "none";
  columnMappingEl.style.display = "block";
  renderColumnMapping(columnMappingEl, {
    message: err.message,
    previewHeader: err.previewHeader,
    previewRows: err.previewRows,
    onApply({ groupIdColumn, genomeColumns }) {
      runBusy(() => {
        const data = parse(text, { filename: name, groupIdColumn, genomeColumns });
        loadData(data, name);
      }).catch((retryErr) => {
        showError(`Still couldn't parse ${name} with that mapping: ${retryErr && retryErr.message ? retryErr.message : retryErr}`);
      });
    },
    onCancel() {
      columnMappingEl.style.display = "none";
      if (handle) explorerEl.style.display = "flex"; // a dataset was already loaded — go back to it
      else empty.style.display = "block";
    },
  });
}

/** Read a File as text, transparently gunzipping/unzipping it first if it's compressed. */
async function readTextFile(file) {
  const decompressed = await decompressIfNeeded(file);
  return decompressed || { text: await file.text(), filename: file.name };
}

async function openFile(file) {
  if (!file) return;
  let text, name;
  try { ({ text, filename: name } = await readTextFile(file)); }
  catch (err) { showError(`Couldn't read ${file.name}: ${err && err.message ? err.message : err}`); return; }
  openText(text, name);
}

// --- file input / buttons ---
fileInput.addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  openFile(f);
  fileInput.value = ""; // allow re-opening the same filename
});
const pick = () => fileInput.click();
document.getElementById("uploadBtn").addEventListener("click", pick);
document.getElementById("emptyOpen").addEventListener("click", pick);

// --- paste tabular text anywhere (except into a field) to load it ---
window.addEventListener("paste", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // don't hijack form paste
  const text = e.clipboardData && e.clipboardData.getData("text");
  if (!text || !/[,\t]/.test(text)) return; // needs to at least look like delimited data
  e.preventDefault();
  openText(text, "pasted data");
});

// --- draggable sidebar width (shell-level) ---
(() => {
  const side = document.getElementById("side");
  const resizer = document.getElementById("sideResize");
  if (!side || !resizer) return;
  const MIN = 200, MAX = 620;
  const saved = +localStorage.getItem("clannPangenomeSideW");
  if (saved >= MIN && saved <= MAX) side.style.width = saved + "px";
  let dragging = false;
  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    try { resizer.setPointerCapture(e.pointerId); } catch { /* non-pointer env */ }
    resizer.classList.add("drag");
    document.body.style.userSelect = "none";
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const w = Math.max(MIN, Math.min(MAX, e.clientX - side.getBoundingClientRect().left));
    side.style.width = w + "px";
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { resizer.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    resizer.classList.remove("drag");
    document.body.style.userSelect = "";
    localStorage.setItem("clannPangenomeSideW", parseInt(side.style.width, 10) || "");
  };
  resizer.addEventListener("pointerup", end);
  resizer.addEventListener("pointercancel", end);
  resizer.addEventListener("dblclick", () => { side.style.width = ""; localStorage.removeItem("clannPangenomeSideW"); });
})();

// --- light/dark toggle (shell-level: active even before a file is loaded) ---
document.getElementById("themeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === "dark" ? "light" : "dark";
});

// --- drag & drop over the canvas ---
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
wrap.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (dragDepth++ === 0) drop.classList.add("on"); });
wrap.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
wrap.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove("on"); } });
wrap.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; drop.classList.remove("on");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  openFile(f);
});

// --- frequency class thresholds (build brief §9a: user-adjustable, session-only) ---
const thCore = document.getElementById("thCore");
const thSoftcore = document.getElementById("thSoftcore");
const thShell = document.getElementById("thShell");

function writeThresholdInputs(thresholds) {
  thCore.value = thresholds.core;
  thSoftcore.value = thresholds.softcore;
  thShell.value = thresholds.shell;
}

function onThresholdChange(key, input) {
  return () => {
    if (!currentData) return;
    const next = adjustThresholds(currentData.meta.freqClassThresholds, key, Number(input.value));
    assignFrequencyClasses(currentData, next);
    writeThresholdInputs(next);
    refreshExplorer();
  };
}
thCore.addEventListener("change", onThresholdChange("core", thCore));
thSoftcore.addEventListener("change", onThresholdChange("softcore", thSoftcore));
thShell.addEventListener("change", onThresholdChange("shell", thShell));

// --- annotation upload (Workflow A/B auto-detected) ---
const annotationFileInput = document.getElementById("annotationFileInput");
const annotationStatus = document.getElementById("annotationStatus");
const annotationConsensusControls = document.getElementById("annotationConsensusControls");
document.getElementById("loadAnnotationBtn").addEventListener("click", () => annotationFileInput.click());

function applyAnnotationText(text, name, { reuseSourceKey = false } = {}) {
  if (!currentData) return;
  const workflow = detectAnnotationWorkflow(currentData, text);
  if (workflow === "unknown") {
    showError(`Couldn't tell whether ${name} is one row per group or one row per gene — check its ID column matches your group IDs or constituent gene IDs.`);
    return;
  }
  lastAnnotationText = text;
  const sourceKey = reuseSourceKey ? lastAnnotationSourceKey || undefined : undefined;
  if (workflow === "A") {
    const { matched, unmatchedIds, key, header } = applyWorkflowA(currentData, text, { sourceKey });
    lastAnnotationSourceKey = key;
    annotationStatus.textContent = `${name}: Workflow A — added column "${header}", ${matched} group${matched === 1 ? "" : "s"} annotated` +
      (unmatchedIds.length ? `, ${unmatchedIds.length} unmatched ID(s).` : ".");
    annotationConsensusControls.style.display = "none";
  } else {
    const minCount = Number(document.getElementById("annMinCount").value) || 1;
    const minPercent = Number(document.getElementById("annMinPercent").value) || 50;
    const { matched, unmatchedIds, acceptedCount, rejectedCount, key, header } = applyWorkflowB(currentData, text, { minCount, minPercent, sourceKey });
    lastAnnotationSourceKey = key;
    annotationStatus.textContent = `${name}: Workflow B — added column "${header}", ${matched} gene(s) matched, ${acceptedCount} group(s) reached consensus, ` +
      `${rejectedCount} below threshold (breakdown still visible)` +
      (unmatchedIds.length ? `, ${unmatchedIds.length} unmatched gene ID(s).` : ".");
    annotationConsensusControls.style.display = "";
  }
  refreshExplorer();
}

annotationFileInput.addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  annotationFileInput.value = "";
  if (!f) return;
  let text, name;
  try { ({ text, filename: name } = await readTextFile(f)); }
  catch (err) { showError(`Couldn't read ${f.name}: ${err && err.message ? err.message : err}`); return; }
  try { applyAnnotationText(text, name); }
  catch (err) { showError(`Couldn't parse ${name} as an annotation file: ${err && err.message ? err.message : err}`); }
});

document.getElementById("annReapply").addEventListener("click", () => {
  if (!lastAnnotationText) return;
  applyAnnotationText(lastAnnotationText, "annotation file", { reuseSourceKey: true });
});

// --- category tagging: keyword match or two-column list upload ---
document.getElementById("tagKeywordBtn").addEventListener("click", () => {
  if (!currentData) return;
  const tagName = document.getElementById("tagName").value.trim();
  const keywords = document.getElementById("tagKeywords").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!tagName || !keywords.length) { showError("Enter a tag name and at least one keyword."); return; }
  const count = keywordTag(currentData, tagName, keywords);
  document.getElementById("tagListStatus").textContent = `Tagged ${count} group(s) as "${tagName}".`;
  refreshExplorer();
});

const tagListFileInput = document.getElementById("tagListFileInput");
document.getElementById("loadTagListBtn").addEventListener("click", () => tagListFileInput.click());
tagListFileInput.addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  tagListFileInput.value = "";
  if (!f || !currentData) return;
  let text, name;
  try { ({ text, filename: name } = await readTextFile(f)); }
  catch (err) { showError(`Couldn't read ${f.name}: ${err && err.message ? err.message : err}`); return; }
  try {
    const { matched, unmatchedIds } = listUploadTag(currentData, text);
    document.getElementById("tagListStatus").textContent = `${name}: tagged ${matched} group(s)` +
      (unmatchedIds.length ? `, ${unmatchedIds.length} unmatched ID(s).` : ".");
    refreshExplorer();
  } catch (err) {
    showError(`Couldn't parse ${name} as a tag list: ${err && err.message ? err.message : err}`);
  }
});

// --- CoinFinder pair uploads (associated / disassociated) ---
// TODO: route parseCoinfinderFile's ColumnMappingNeeded through an
// interactive remap UI (like renderColumnMapping) instead of just
// reporting the error — best-guess detection covers the common case
// (named ID/significance columns, or IDs matching loaded groups) but a
// truly unrecognisable file currently has no manual-correction path yet.
function wireCoinfinderUpload(inputId, btnId, statusId, direction) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);
  document.getElementById(btnId).addEventListener("click", () => input.click());
  input.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    input.value = "";
    if (!f || !currentData) return;
    let text, name;
    try { ({ text, filename: name } = await readTextFile(f)); }
    catch (err) { showError(`Couldn't read ${f.name}: ${err && err.message ? err.message : err}`); return; }
    try {
      const rows = parseCoinfinderFile(text, currentData);
      const { matched, unmatched } = resolvePairs(currentData, rows, direction);
      status.textContent = `${name}: ${matched} pair(s) resolved` + (unmatched ? `, ${unmatched} unmatched.` : ".");
      refreshExplorer();
    } catch (err) {
      showError(`Couldn't parse ${name} as a CoinFinder ${direction} pairs file: ${err && err.message ? err.message : err}`);
    }
  });
}
wireCoinfinderUpload("associatedFileInput", "loadAssociatedBtn", "associatedStatus", "associated");
wireCoinfinderUpload("disassociatedFileInput", "loadDisassociatedBtn", "disassociatedStatus", "disassociated");

// --- footer: show the repo's live star count next to the "Like it?" button ---
fetch("https://api.github.com/repos/ChrisCreevey/clann-pangenome-explorer")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    const c = document.getElementById("starCount");
    if (c && d && d.stargazers_count > 0) { c.textContent = d.stargazers_count; c.hidden = false; }
  })
  .catch(() => {});

// --- optional deep link: index.html?data=examples/... ---
const q = new URLSearchParams(location.search).get("data");
if (q) {
  fetch(q)
    .then((r) => { if (!r.ok) throw new Error(r.status + " " + r.statusText); return r.text(); })
    .then((text) => openText(text, q.split("/").pop()))
    .catch((err) => showError(`Couldn't load ${q}: ${err.message}`));
}
