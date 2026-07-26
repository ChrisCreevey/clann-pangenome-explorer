// pair-table.js — sortable table of CoinFinder pairs (build brief §6
// Phase 6). Each side is shown with its own group's category and
// frequency class, since a pair referencing an uncategorised or
// unannotated group is common and often the most interesting case, not
// something to hide.

import { categoryFor } from "../analysis/pairs.js";

const NUMERIC = new Set(["significance"]);
const COLS = ["groupIdA", "categoryA", "freqClassA", "direction", "significance", "groupIdB", "categoryB", "freqClassB"];
const COL_LABELS = {
  groupIdA: "Group A", categoryA: "Category A", freqClassA: "Class A",
  direction: "Direction", significance: "Significance",
  groupIdB: "Group B", categoryB: "Category B", freqClassB: "Class B",
};

function rowData(pair) {
  return {
    groupIdA: pair.groupIdA, categoryA: categoryFor(pair.resolvedA), freqClassA: pair.resolvedA.freqClass,
    groupIdB: pair.groupIdB, categoryB: categoryFor(pair.resolvedB), freqClassB: pair.resolvedB.freqClass,
    direction: pair.direction, significance: pair.significance,
    pair,
  };
}

function fmt(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toExponential(2);
  return String(v);
}

/**
 * Render a sortable table of resolved pairs into `container`.
 * Returns a handle with setPairs(pairs) to update in place.
 */
export function renderPairTable(container, pairs, opts = {}) {
  let sortCol = opts.defaultSort || "significance";
  let sortAsc = opts.defaultSort ? true : true;
  let current = pairs;

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const countLabel = document.createElement("div");
  countLabel.className = "hint";
  wrap.appendChild(countLabel);
  const table = document.createElement("table");
  table.className = "data-table";
  wrap.appendChild(table);

  function draw() {
    const rows = current.map(rowData);
    countLabel.textContent = `${rows.length} pair${rows.length === 1 ? "" : "s"}`;
    rows.sort((a, b) => {
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
    for (const col of COLS) {
      const th = document.createElement("th");
      th.textContent = COL_LABELS[col];
      if (col === sortCol) th.className = "sorted" + (sortAsc ? " asc" : "");
      th.addEventListener("click", () => {
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        draw();
      });
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const MAX_ROWS = 500;
    for (const row of rows.slice(0, MAX_ROWS)) {
      const tr = document.createElement("tr");
      if (opts.onRowClick) {
        tr.classList.add("row-clickable");
        tr.addEventListener("click", () => opts.onRowClick(row.pair));
      }
      for (const col of COLS) {
        const td = document.createElement("td");
        if (NUMERIC.has(col)) td.className = "num";
        if (col === "direction") {
          const badge = document.createElement("span");
          badge.className = "flag-badge " + (row.direction === "associated" ? "flag-hit" : "flag-none");
          badge.textContent = row.direction;
          td.appendChild(badge);
        } else {
          td.textContent = fmt(row[col]);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  draw();
  container.innerHTML = "";
  container.appendChild(wrap);

  return {
    setPairs(newPairs) { current = newPairs; draw(); },
  };
}
