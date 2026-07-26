// group-detail.js — per-group detail card (build brief §7): group ID,
// annotation + consistency score/disagreement breakdown, category tags,
// frequency class, isolate/sequence counts, average copies, and a
// collapsible list of constituent gene IDs by genome, plus an export
// button for that group's gene IDs. Shown as a dismissible overlay so it
// can be opened from a row click in any group table (Filtered groups,
// pattern match, multi-copy candidates) without navigating away.

import { geneIdListText } from "../../export/group-export.js";
import { downloadText } from "./download-util.js";

const FREQ_CLASS_LABELS = { core: "Core", softcore: "Soft-core", shell: "Shell", cloud: "Cloud" };

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v; else e.setAttribute(k, v);
  }
  for (const c of children || []) e.appendChild(c);
  return e;
}

export function renderGroupDetail(container, group) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "detail-header";
  const title = document.createElement("h2");
  title.textContent = group.groupId;
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.className = "act detail-close";
  closeBtn.textContent = "Close ✕";
  header.appendChild(closeBtn);
  container.appendChild(header);

  const dl = document.createElement("dl");
  dl.className = "detail-dl";
  const entries = [
    ["Annotation", group.annotation || "—"],
    ["Frequency class", FREQ_CLASS_LABELS[group.freqClass] || group.freqClass],
    ["Category tags", group.tags.length ? group.tags.join(", ") : "—"],
    ["Genomes present in", String(group.genomesPresentIn)],
    ["Sequences total", String(group.sequencesTotal)],
    ["Avg copies per genome", group.avgCopiesPerGenome.toFixed(2)],
  ];
  if (group.consistencyScore != null) entries.splice(1, 0, ["Consensus consistency", `${(group.consistencyScore * 100).toFixed(1)}%`]);
  for (const [label, value] of entries) {
    dl.appendChild(el("dt", { text: label }));
    dl.appendChild(el("dd", { text: value }));
  }
  container.appendChild(dl);

  if (group.annotationBreakdown && group.annotationBreakdown.length > 1) {
    const details = document.createElement("details");
    details.className = "sect";
    const summary = document.createElement("summary");
    summary.textContent = `Annotation disagreement (${group.annotationBreakdown.length} distinct calls)`;
    details.appendChild(summary);
    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = "<thead><tr><th>Annotation</th><th>Count</th><th>%</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const b of group.annotationBreakdown) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${b.annotation}</td><td class="num">${b.count}</td><td class="num">${b.pct.toFixed(1)}%</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    details.appendChild(table);
    container.appendChild(details);
  }

  const geneDetails = document.createElement("details");
  geneDetails.className = "sect";
  geneDetails.open = false;
  const geneSummary = document.createElement("summary");
  geneSummary.textContent = "Constituent gene IDs by genome";
  geneDetails.appendChild(geneSummary);
  const genomeNames = Object.keys(group.cells).filter((name) => group.cells[name].geneIds && group.cells[name].geneIds.length);
  if (genomeNames.length) {
    const list = document.createElement("dl");
    list.className = "detail-dl";
    for (const name of genomeNames) {
      list.appendChild(el("dt", { text: name }));
      list.appendChild(el("dd", { text: group.cells[name].geneIds.join(", ") }));
    }
    geneDetails.appendChild(list);
  } else {
    geneDetails.appendChild(el("div", { class: "hint", text: "No per-gene IDs available for this group (matrix didn't include gene-ID cells)." }));
  }
  container.appendChild(geneDetails);

  const exportBtn = document.createElement("button");
  exportBtn.className = "act";
  exportBtn.style.width = "auto";
  exportBtn.textContent = "Export this group's gene IDs (.txt)";
  exportBtn.addEventListener("click", () => downloadText(`${group.groupId}-gene-ids.txt`, geneIdListText([group])));
  container.appendChild(exportBtn);

  const crossLink = document.createElement("div");
  crossLink.className = "hint";
  crossLink.style.marginTop = "8px";
  crossLink.innerHTML = `Extract these sequences, then explore hits in <a href="https://chriscreevey.github.io/clann-blast-explorer/" target="_blank" rel="noopener">Clann BLAST Explorer</a>, or align and build a tree in <a href="https://chriscreevey.github.io/clann-tree-viewer/" target="_blank" rel="noopener">Clann Tree Viewer</a>.`;
  container.appendChild(crossLink);

  return closeBtn;
}

let overlayEl = null, cardEl = null;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.getElementById("groupDetailOverlay");
  cardEl = document.getElementById("groupDetailCard");
  overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) closeGroupDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeGroupDetail(); });
}

export function openGroupDetail(group) {
  ensureOverlay();
  const closeBtn = renderGroupDetail(cardEl, group);
  closeBtn.addEventListener("click", closeGroupDetail);
  overlayEl.style.display = "flex";
}

export function closeGroupDetail() {
  if (overlayEl) overlayEl.style.display = "none";
}
