// group-table.js — sortable table of gene groups, used by the Phase 4
// filter/top-hit views. Adapted from clann-blast-explorer's hit-table.js
// sortable-column pattern.

const NUMERIC = new Set(["genomesPresentIn", "sequencesTotal", "avgCopiesPerGenome", "consistencyScore"]);
export const DEFAULT_COLS = ["groupId", "annotation", "freqClass", "genomesPresentIn", "sequencesTotal", "avgCopiesPerGenome"];
const COL_LABELS = {
  groupId: "Group", annotation: "Annotation", freqClass: "Class",
  genomesPresentIn: "Genomes", sequencesTotal: "Sequences", avgCopiesPerGenome: "Avg copies",
  consistencyScore: "Consistency", tags: "Tags",
};

function fmt(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

/**
 * Render a sortable table of groups into `container`.
 * Returns a handle with setGroups(groups) to update in place.
 */
export function renderGroupTable(container, groups, opts = {}) {
  const cols = opts.columns || DEFAULT_COLS;
  const labels = { ...COL_LABELS, ...(opts.columnLabels || {}) };
  const numeric = new Set([...NUMERIC, ...(opts.numericColumns || [])]);
  let sortCol = opts.defaultSort || "genomesPresentIn";
  let sortAsc = false;
  let current = groups;

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data-table";
  wrap.appendChild(table);

  const countLabel = document.createElement("div");
  countLabel.className = "hint";
  wrap.insertBefore(countLabel, table);
  const truncatedNote = document.createElement("div");
  truncatedNote.className = "hint";
  wrap.appendChild(truncatedNote);

  function draw() {
    countLabel.textContent = `${current.length} group${current.length === 1 ? "" : "s"}`;
    const sorted = current.slice().sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });

    table.innerHTML = "";
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const col of cols) {
      const th = document.createElement("th");
      th.textContent = labels[col] || col;
      if (col === sortCol) th.className = "sorted" + (sortAsc ? " asc" : "");
      th.addEventListener("click", () => {
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = false; }
        draw();
      });
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const MAX_ROWS = 500; // keep the DOM light for large pangenomes; sorting/filtering still operate on the full set
    for (const group of sorted.slice(0, MAX_ROWS)) {
      const tr = document.createElement("tr");
      if (opts.onRowClick) {
        tr.classList.add("row-clickable");
        tr.addEventListener("click", () => opts.onRowClick(group));
      }
      for (const col of cols) {
        const td = document.createElement("td");
        if (numeric.has(col)) td.className = "num";
        td.textContent = fmt(group[col]);
        if ((col === "annotation" || col.startsWith("ann_")) && !group[col]) td.textContent = "—";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    truncatedNote.textContent = sorted.length > MAX_ROWS
      ? `Showing the first ${MAX_ROWS} of ${sorted.length} groups (sorted/filtered) — narrow the filters to see more specific rows.`
      : "";
  }

  draw();
  container.innerHTML = "";
  container.appendChild(wrap);

  return {
    setGroups(newGroups) { current = newGroups; draw(); },
  };
}
