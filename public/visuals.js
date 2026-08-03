// ============================================================
// Visual learning components (product redesign, Phase 3).
// Hand-coded inline SVG, same technique the dashboard's progress arc
// already uses in index.html/app.js — no charting library, no build
// step. Renders a `VisualSpec` (see src/types/index.ts) authored as
// curated lesson content, never generated live per-request.
//
// Plain global script (matches app.js's existing pattern — no module
// system in this project). Exposes a global `Visuals.render(spec)` — a
// top-level `const` here becomes a global lexical binding, not a
// `window.Visuals` property, so other scripts must reference the bare
// identifier `Visuals`, not `window.Visuals` (which is always undefined).
// ============================================================

const Visuals = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function textEl(x, y, content, opts = {}) {
    const t = svgEl('text', {
      x, y,
      'text-anchor': opts.anchor || 'middle',
      'font-size': opts.size || 12,
      'font-family': "'IBM Plex Sans Arabic', sans-serif",
      fill: opts.fill || 'var(--ink)',
      'font-weight': opts.weight || 400,
    });
    t.textContent = content;
    return t;
  }

  /** Number lines are inherently a Western/LTR convention even inside an RTL
   *  page — dir="ltr" here matches the existing .counter-ltr convention already
   *  used for exam timers/digit sequences elsewhere in style.css. */
  function renderNumberLine(spec) {
    const width = 320, height = 100, padding = 28;
    const span = spec.max - spec.min || 1;
    const scaleX = (v) => padding + ((v - spec.min) / span) * (width - 2 * padding);
    const midY = height / 2;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-number-line', dir: 'ltr' });
    svg.appendChild(svgEl('line', { x1: scaleX(spec.min), x2: scaleX(spec.max), y1: midY, y2: midY, stroke: 'var(--line)', 'stroke-width': 2 }));
    // Arrowheads to signal the line continues past min/max
    for (const [end, dir] of [[spec.min, -1], [spec.max, 1]]) {
      const x = scaleX(end);
      svg.appendChild(svgEl('line', { x1: x, y1: midY, x2: x + dir * 7, y2: midY - 5, stroke: 'var(--line)', 'stroke-width': 2 }));
      svg.appendChild(svgEl('line', { x1: x, y1: midY, x2: x + dir * 7, y2: midY + 5, stroke: 'var(--line)', 'stroke-width': 2 }));
    }
    if (spec.min <= 0 && spec.max >= 0) {
      const x0 = scaleX(0);
      svg.appendChild(svgEl('line', { x1: x0, y1: midY - 6, x2: x0, y2: midY + 6, stroke: 'var(--ink-soft)', 'stroke-width': 1.5 }));
    }
    spec.points.forEach((p) => {
      const x = scaleX(p.value);
      svg.appendChild(svgEl('circle', { cx: x, cy: midY, r: 6, fill: 'var(--accent)', stroke: 'white', 'stroke-width': 1.5 }));
      svg.appendChild(textEl(x, midY - 16, p.label, { size: 13, weight: 600 }));
      svg.appendChild(textEl(x, midY + 22, String(p.value), { size: 11, fill: 'var(--text-muted)' }));
    });
    return svg;
  }

  function renderGeometry(spec) {
    const width = 240, height = 180;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-geometry' });
    const fill = 'var(--teal-tint)';
    const stroke = 'var(--ink)';
    const labels = spec.labels || [];

    if (spec.shape === 'rectangle') {
      const w = 150, h = 90, x = (width - w) / 2, y = (height - h) / 2;
      svg.appendChild(svgEl('rect', { x, y, width: w, height: h, fill, stroke, 'stroke-width': 2, rx: 3 }));
      if (labels[0]) svg.appendChild(textEl(x + w / 2, y - 10, labels[0], { size: 13, weight: 600 }));
      if (labels[1]) svg.appendChild(textEl(x + w + 22, y + h / 2, labels[1], { size: 13, weight: 600 }));
    } else if (spec.shape === 'triangle') {
      const points = `${width / 2},${height * 0.15} ${width * 0.15},${height * 0.85} ${width * 0.85},${height * 0.85}`;
      svg.appendChild(svgEl('polygon', { points, fill, stroke, 'stroke-width': 2 }));
      if (labels[0]) svg.appendChild(textEl(width / 2, height * 0.95, labels[0], { size: 13, weight: 600 }));
      if (labels[1]) svg.appendChild(textEl(width * 0.72, height * 0.52, labels[1], { size: 13, weight: 600 }));
    } else if (spec.shape === 'circle') {
      const r = 58, cx = width / 2, cy = height / 2;
      svg.appendChild(svgEl('circle', { cx, cy, r, fill, stroke, 'stroke-width': 2 }));
      svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: cx + r, y2: cy, stroke: 'var(--ink-soft)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      if (labels[0]) svg.appendChild(textEl(cx + r / 2, cy - 8, labels[0], { size: 13, weight: 600 }));
    } else if (spec.shape === 'trapezoid') {
      const points = `${width * 0.3},${height * 0.2} ${width * 0.7},${height * 0.2} ${width * 0.9},${height * 0.8} ${width * 0.1},${height * 0.8}`;
      svg.appendChild(svgEl('polygon', { points, fill, stroke, 'stroke-width': 2 }));
      if (labels[0]) svg.appendChild(textEl(width / 2, height * 0.13, labels[0], { size: 13, weight: 600 }));
      if (labels[1]) svg.appendChild(textEl(width / 2, height * 0.95, labels[1], { size: 13, weight: 600 }));
    }
    return svg;
  }

  function renderTable(spec) {
    const table = document.createElement('table');
    table.className = 'visual-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    spec.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    spec.rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderFlowDiagram(spec) {
    const container = document.createElement('div');
    container.className = 'visual-flow';
    spec.steps.forEach((step, i) => {
      const stepEl = document.createElement('div');
      stepEl.className = 'visual-flow-step';
      const num = document.createElement('span');
      num.className = 'visual-flow-num';
      num.textContent = String(i + 1);
      const text = document.createElement('span');
      text.className = 'visual-flow-text';
      text.textContent = step;
      stepEl.append(num, text);
      container.appendChild(stepEl);
      if (i < spec.steps.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'visual-flow-arrow';
        arrow.textContent = '↓';
        container.appendChild(arrow);
      }
    });
    return container;
  }

  function renderBarChart(spec) {
    const width = 300, height = 170, padding = 32;
    const maxVal = Math.max(...spec.bars.map((b) => b.value), 1);
    const gap = (width - 2 * padding) / spec.bars.length;
    const barWidth = gap * 0.55;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-bar-chart' });
    svg.appendChild(svgEl('line', { x1: padding, x2: width - padding, y1: height - padding, y2: height - padding, stroke: 'var(--line)', 'stroke-width': 1.5 }));
    spec.bars.forEach((bar, i) => {
      const barHeight = ((height - 2 * padding) * bar.value) / maxVal;
      const x = padding + i * gap + (gap - barWidth) / 2;
      const y = height - padding - barHeight;
      svg.appendChild(svgEl('rect', { x, y, width: barWidth, height: barHeight, fill: 'var(--accent)', rx: 3 }));
      svg.appendChild(textEl(x + barWidth / 2, y - 8, String(bar.value), { size: 11 }));
      svg.appendChild(textEl(x + barWidth / 2, height - padding + 18, bar.label, { size: 11, fill: 'var(--text-muted)' }));
    });
    return svg;
  }

  // ---------- Educational Rendering Engine additions ----------
  // Same contract as the five renderers above: hand-coded inline SVG, driven
  // entirely by curated `parameters` in the lesson data — never computed from
  // guessed numbers. Fractions/percentages/comparisons are the highest-volume
  // Qudrat quantitative topics without a dedicated visual until now.

  /** A single horizontal bar divided into `denominator` equal segments, with
   *  `numerator` of them filled — the canonical "part of a whole" fraction
   *  visual used across Khan-Academy-style math products. */
  function renderFractionBar(spec) {
    const width = 300, height = 70, segGap = 3;
    const denom = Math.max(1, spec.denominator);
    const segWidth = (width - segGap * (denom - 1)) / denom;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-fraction-bar' });
    for (let i = 0; i < denom; i++) {
      const x = i * (segWidth + segGap);
      const filled = i < spec.numerator;
      svg.appendChild(svgEl('rect', {
        x, y: 10, width: segWidth, height: 32, rx: 4,
        fill: filled ? 'var(--accent)' : 'var(--paper-dim)',
        stroke: 'var(--line)', 'stroke-width': 1.5,
      }));
    }
    svg.appendChild(textEl(width / 2, 60, `${spec.numerator}/${spec.denominator}${spec.label ? ' — ' + spec.label : ''}`, { size: 13, weight: 600 }));
    return svg;
  }

  /** A circle sliced into `denominator` equal wedges, `numerator` of them
   *  filled — the complementary "pie" representation of the same fraction,
   *  useful right next to FractionBar so a lesson can show both at once. */
  function renderPieFraction(spec) {
    const size = 140, cx = size / 2, cy = size / 2 - 6, r = 50;
    const denom = Math.max(1, spec.denominator);
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'visual-svg visual-pie-fraction' });
    const anglePer = (2 * Math.PI) / denom;
    for (let i = 0; i < denom; i++) {
      const start = i * anglePer - Math.PI / 2;
      const end = start + anglePer;
      const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      const largeArc = anglePer > Math.PI ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      svg.appendChild(svgEl('path', {
        d: path, fill: i < spec.numerator ? 'var(--accent)' : 'var(--paper-dim)',
        stroke: 'white', 'stroke-width': 2,
      }));
    }
    svg.appendChild(textEl(cx, size - 6, `${spec.numerator}/${spec.denominator}${spec.label ? ' — ' + spec.label : ''}`, { size: 12, weight: 600 }));
    return svg;
  }

  /** A 10x10 grid of cells, `percent` of them filled — the standard "hundred
   *  grid" percentage visual, one cell = one percentage point. */
  function renderPercentageGrid(spec) {
    const cols = 10, rows = 10, cell = 20, gap = 2;
    const width = cols * (cell + gap), height = rows * (cell + gap) + 22;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-percentage-grid' });
    const filledCount = Math.round((spec.percent / 100) * (cols * rows));
    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      svg.appendChild(svgEl('rect', {
        x: col * (cell + gap), y: row * (cell + gap), width: cell, height: cell, rx: 2,
        fill: i < filledCount ? 'var(--accent)' : 'var(--paper-dim)',
      }));
    }
    svg.appendChild(textEl(width / 2, height - 4, `${spec.percent}%${spec.label ? ' — ' + spec.label : ''}`, { size: 13, weight: 600 }));
    return svg;
  }

  /** Two horizontal bars side by side for direct visual comparison — used for
   *  quantitative-comparison and ratio content where "which is bigger" is
   *  the entire point of the question. */
  function renderComparisonBar(spec) {
    const width = 300, height = 110, padding = 60;
    const maxVal = Math.max(spec.left.value, spec.right.value, 1);
    const barMaxWidth = width - padding;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-comparison-bar' });
    [spec.left, spec.right].forEach((entry, i) => {
      const y = 12 + i * 46;
      const barWidth = Math.max(4, (entry.value / maxVal) * barMaxWidth);
      svg.appendChild(textEl(4, y + 14, entry.label, { anchor: 'start', size: 12, weight: 600 }));
      svg.appendChild(svgEl('rect', {
        x: 4, y: y + 20, width: barWidth, height: 16, rx: 4,
        fill: i === 0 ? 'var(--accent)' : 'var(--teal)',
      }));
      svg.appendChild(textEl(barWidth + 10, y + 33, String(entry.value), { anchor: 'start', size: 11, fill: 'var(--text-muted)' }));
    });
    return svg;
  }

  // ---------- Version 6 Phase M: closing the wishlist gaps ----------
  // Same contract as every renderer above: hand-coded inline SVG driven by
  // curated `parameters` — nothing here computes or guesses a number.

  /** A single bar split proportionally into two colored segments, labeled
   *  "a : b" underneath — distinct from renderComparisonBar's two SEPARATE
   *  bars: this shows the ratio as one whole divided in proportion, the more
   *  common textbook framing for ratio_and_proportions content. Was a
   *  dangling reference in CATEGORY_VISUAL_HINTS below (`'ratio_bar'`) with
   *  no renderer behind it until now. */
  function renderRatioBar(spec) {
    const width = 300, height = 90;
    const total = spec.left.value + spec.right.value || 1;
    const leftWidth = Math.max(0, Math.min(width, (spec.left.value / total) * width));
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-ratio-bar' });
    svg.appendChild(svgEl('rect', { x: 0, y: 20, width: leftWidth, height: 32, fill: 'var(--accent)' }));
    svg.appendChild(svgEl('rect', { x: leftWidth, y: 20, width: width - leftWidth, height: 32, rx: 0, fill: 'var(--teal)' }));
    svg.appendChild(svgEl('rect', { x: 0, y: 20, width, height: 32, fill: 'none', stroke: 'white', 'stroke-width': 2 }));
    if (leftWidth > 30) svg.appendChild(textEl(leftWidth / 2, 40, spec.left.label, { size: 12, weight: 600, fill: 'white' }));
    if (width - leftWidth > 30) svg.appendChild(textEl(leftWidth + (width - leftWidth) / 2, 40, spec.right.label, { size: 12, weight: 600, fill: 'white' }));
    svg.appendChild(textEl(width / 2, 72, `${spec.left.value} : ${spec.right.value}`, { size: 13, weight: 600 }));
    return svg;
  }

  /** A horizontal sequence of dated/ordered events on a line — distinct from
   *  renderFlowDiagram's vertical DOM steps-with-arrows (which represents a
   *  decision/procedure), this is the literal chronological-sequence shape
   *  (a process over time, a history of steps already taken). `dir="ltr"`
   *  for the same reason number lines are — a sequence-left-to-right
   *  convention even inside an RTL page. */
  function renderTimeline(spec) {
    const events = spec.events || [];
    const width = Math.max(280, events.length * 90), height = 100, padding = 30;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-timeline', dir: 'ltr' });
    const y = height / 2;
    svg.appendChild(svgEl('line', { x1: padding, x2: width - padding, y1: y, y2: y, stroke: 'var(--line)', 'stroke-width': 2 }));
    const gap = (width - 2 * padding) / Math.max(1, events.length - 1);
    events.forEach((ev, i) => {
      const x = events.length === 1 ? width / 2 : padding + i * gap;
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 7, fill: 'var(--accent)', stroke: 'white', 'stroke-width': 2 }));
      svg.appendChild(textEl(x, y - 16, ev.label, { size: 12, weight: 600 }));
      if (ev.sublabel) svg.appendChild(textEl(x, y + 24, ev.sublabel, { size: 10, fill: 'var(--text-muted)' }));
    });
    return svg;
  }

  // ---------- Version 4 Phase F: two genuinely-new renderers ----------
  // Same contract as every renderer above: hand-coded inline SVG driven by
  // curated `parameters` — nothing here computes or guesses a number.

  /** A two-pan balance scale — the standard "equation as equality" visual for
   *  algebra. `tilt` ('left'|'right'|omitted) tips the beam toward whichever
   *  side is heavier; omitted/level represents a correctly-balanced equation,
   *  which is the common case (the whole point of an equation is that both
   *  sides ARE equal). */
  function renderEquationBalance(spec) {
    const width = 280, height = 170, cx = width / 2, pivotY = 46;
    const tiltDeg = spec.tilt === 'left' ? -8 : spec.tilt === 'right' ? 8 : 0;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-equation-balance' });

    svg.appendChild(svgEl('polygon', { points: `${cx - 7},${height - 24} ${cx + 7},${height - 24} ${cx},${pivotY}`, fill: 'var(--ink)' }));
    svg.appendChild(svgEl('rect', { x: cx - 34, y: height - 26, width: 68, height: 8, rx: 3, fill: 'var(--ink)' }));

    const beam = svgEl('g', { transform: `rotate(${tiltDeg} ${cx} ${pivotY})` });
    beam.appendChild(svgEl('line', { x1: cx - 92, y1: pivotY, x2: cx + 92, y2: pivotY, stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linecap': 'round' }));
    beam.appendChild(svgEl('line', { x1: cx - 92, y1: pivotY, x2: cx - 92, y2: pivotY + 28, stroke: 'var(--text-muted)', 'stroke-width': 1.5 }));
    beam.appendChild(svgEl('rect', { x: cx - 124, y: pivotY + 28, width: 64, height: 28, rx: 7, fill: 'var(--accent-tint)', stroke: 'var(--accent)', 'stroke-width': 1.5 }));
    beam.appendChild(textEl(cx - 92, pivotY + 46, spec.leftLabel || '', { size: 12.5, weight: 600 }));
    beam.appendChild(svgEl('line', { x1: cx + 92, y1: pivotY, x2: cx + 92, y2: pivotY + 28, stroke: 'var(--text-muted)', 'stroke-width': 1.5 }));
    beam.appendChild(svgEl('rect', { x: cx + 60, y: pivotY + 28, width: 64, height: 28, rx: 7, fill: 'var(--teal-tint)', stroke: 'var(--teal)', 'stroke-width': 1.5 }));
    beam.appendChild(textEl(cx + 92, pivotY + 46, spec.rightLabel || '', { size: 12.5, weight: 600 }));
    svg.appendChild(beam);
    svg.appendChild(svgEl('circle', { cx, cy: pivotY, r: 4, fill: 'var(--ink)' }));
    return svg;
  }

  /** A coordinate plane with plotted points — axes + a light grid, dir="ltr"
   *  for the same reason number lines are (a Western math convention even
   *  inside an RTL page). */
  function renderCoordinatePlane(spec) {
    const width = 260, height = 260, padding = 26;
    const minX = spec.minX ?? -5, maxX = spec.maxX ?? 5, minY = spec.minY ?? -5, maxY = spec.maxY ?? 5;
    const scaleX = (v) => padding + ((v - minX) / (maxX - minX)) * (width - 2 * padding);
    const scaleY = (v) => height - padding - ((v - minY) / (maxY - minY)) * (height - 2 * padding);
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'visual-svg visual-coordinate-plane', dir: 'ltr' });

    for (let x = Math.ceil(minX); x <= Math.floor(maxX); x++) {
      svg.appendChild(svgEl('line', { x1: scaleX(x), y1: scaleY(minY), x2: scaleX(x), y2: scaleY(maxY), stroke: 'var(--paper-dim)', 'stroke-width': 1 }));
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      svg.appendChild(svgEl('line', { x1: scaleX(minX), y1: scaleY(y), x2: scaleX(maxX), y2: scaleY(y), stroke: 'var(--paper-dim)', 'stroke-width': 1 }));
    }
    svg.appendChild(svgEl('line', { x1: scaleX(minX), y1: scaleY(0), x2: scaleX(maxX), y2: scaleY(0), stroke: 'var(--ink-soft)', 'stroke-width': 1.5 }));
    svg.appendChild(svgEl('line', { x1: scaleX(0), y1: scaleY(minY), x2: scaleX(0), y2: scaleY(maxY), stroke: 'var(--ink-soft)', 'stroke-width': 1.5 }));

    (spec.points || []).forEach((p) => {
      const x = scaleX(p.x), y = scaleY(p.y);
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 5, fill: 'var(--accent)', stroke: 'white', 'stroke-width': 1.5 }));
      if (p.label) svg.appendChild(textEl(x, y - 10, p.label, { size: 11, weight: 600 }));
    });
    return svg;
  }

  /** A simple root-with-branches tree for reading-comprehension content
   *  (main idea + supporting details, cause/effect, compare/contrast) —
   *  plain DOM/CSS, not SVG, since it's fundamentally a text layout. */
  function renderMindMap(spec) {
    const container = document.createElement('div');
    container.className = 'visual-mind-map';
    const rootEl = document.createElement('div');
    rootEl.className = 'mind-map-root';
    rootEl.textContent = spec.root;
    container.appendChild(rootEl);
    const branchesEl = document.createElement('div');
    branchesEl.className = 'mind-map-branches';
    (spec.branches || []).forEach((branch) => {
      const branchEl = document.createElement('div');
      branchEl.className = 'mind-map-branch';
      const labelEl = document.createElement('div');
      labelEl.className = 'mind-map-branch-label';
      labelEl.textContent = branch.label;
      branchEl.appendChild(labelEl);
      if (branch.children && branch.children.length > 0) {
        const childList = document.createElement('div');
        childList.className = 'mind-map-branch-children';
        branch.children.forEach((child) => {
          const childEl = document.createElement('div');
          childEl.className = 'mind-map-child';
          childEl.textContent = child;
          childList.appendChild(childEl);
        });
        branchEl.appendChild(childList);
      }
      branchesEl.appendChild(branchEl);
    });
    container.appendChild(branchesEl);
    return container;
  }

  /** Dispatches on spec.type and wraps the result in a labeled container.
   *  Returns null for an unrecognized/missing spec so callers can skip
   *  rendering entirely (text-only content stays text-only). */
  function render(spec) {
    if (!spec || !spec.type) return null;
    let content;
    if (spec.type === 'number_line') content = renderNumberLine(spec);
    else if (spec.type === 'geometry') content = renderGeometry(spec);
    else if (spec.type === 'table') content = renderTable(spec);
    else if (spec.type === 'flow_diagram') content = renderFlowDiagram(spec);
    else if (spec.type === 'bar_chart') content = renderBarChart(spec);
    else if (spec.type === 'fraction_bar') content = renderFractionBar(spec);
    else if (spec.type === 'pie_fraction') content = renderPieFraction(spec);
    else if (spec.type === 'percentage_grid') content = renderPercentageGrid(spec);
    else if (spec.type === 'comparison_bar') content = renderComparisonBar(spec);
    else if (spec.type === 'mind_map') content = renderMindMap(spec);
    else if (spec.type === 'equation_balance') content = renderEquationBalance(spec);
    else if (spec.type === 'coordinate_plane') content = renderCoordinatePlane(spec);
    else if (spec.type === 'ratio_bar') content = renderRatioBar(spec);
    else if (spec.type === 'timeline') content = renderTimeline(spec);
    else return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'visual-container';
    wrapper.appendChild(content);
    return wrapper;
  }

  // Automatic visualization: maps a skill's category to the visual type most
  // likely to help, so a lesson-authoring/renderer path can pick a sensible
  // default WITHOUT ever fabricating the actual numbers/data — this only
  // selects which renderer applies to real curated `parameters`, it never
  // invents content. Used by lesson-renderer.js.
  const CATEGORY_VISUAL_HINTS = {
    fractions: ['fraction_bar', 'pie_fraction'],
    decimals: ['number_line'],
    percentages: ['percentage_grid'],
    ratios_and_proportions: ['comparison_bar', 'ratio_bar'],
    quantitative_comparison: ['comparison_bar'],
    geometry: ['geometry'],
    statistics: ['bar_chart', 'table'],
    data_interpretation: ['table', 'bar_chart'],
    probability: ['number_line', 'percentage_grid'],
    arithmetic: ['flow_diagram'],
    algebra: ['equation_balance', 'flow_diagram', 'coordinate_plane'],
    exponents_and_roots: ['flow_diagram'],
    reading_comprehension: ['mind_map'],
    verbal_analogy: ['mind_map'],
    sentence_completion: ['mind_map'],
    contextual_error: ['mind_map'],
    multi_step_word_problems: ['flow_diagram'],
  };
  function suggestVisualTypesForCategory(category) {
    return CATEGORY_VISUAL_HINTS[category] || [];
  }

  return { render, suggestVisualTypesForCategory };
})();
