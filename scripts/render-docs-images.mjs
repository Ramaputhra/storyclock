// Renders documentation images (screenshots) for the Story Clock plugin.
// Generates crisp SVGs and rasterizes them to PNG via resvg (Rust renderer).

import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('docs', { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const C = {
  bg: '#1e1e1e',
  panel: '#262626',
  input: '#1b1b1b',
  border: '#3c3c3c',
  text: '#dcddde',
  muted: '#8a8a8a',
  accent: '#7c5cff',
};

const FONT = 'Segoe UI, system-ui, sans-serif';

function grayOutColor(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const mix = (c) => Math.round(c * 0.18 + gray * 0.42 + 105 * 0.4);
  const toHex = (c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// ---------------------------------------------------------------------------
// Circle map (with focused segment highlighted and others grayed out)
// ---------------------------------------------------------------------------
function mapInner() {
  const CX = 410, CY = 410, R1I = 150, R1O = 226, R2I = 260, R2O = 336, DEG = 6;
  const polar = (cx, cy, r, a) => { const t = (a * Math.PI) / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
  const sector = (cx, cy, ri, ro, a0, a1) => {
    const [x0, y0] = polar(cx, cy, ri, a0), [x1, y1] = polar(cx, cy, ri, a1);
    const [x2, y2] = polar(cx, cy, ro, a1), [x3, y3] = polar(cx, cy, ro, a0);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${ri} ${ri} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ro} ${ro} 0 ${large} 0 ${x3} ${y3} Z`;
  };
  const mid = (c, ls, le) => {
    const ri = c === 1 ? R1I : R2I, ro = c === 1 ? R1O : R2O;
    const a = ((ls + le + 1) / 2) * DEG, r = (ri + ro) / 2;
    return polar(CX, CY, r, a);
  };
  let out = '';
  for (const [c, ri, ro, label] of [[1, R1I, R1O, 'ACT I · 0–60'], [2, R2I, R2O, 'ACT II · 60–120']]) {
    for (let i = 0; i < 60; i++) {
      out += `<path d="${sector(CX, CY, ri, ro, i * DEG, (i + 1) * DEG)}" fill="${i % 2 ? 'rgba(255,255,255,0.03)' : 'transparent'}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`;
    }
    out += `<circle cx="${CX}" cy="${CY}" r="${ri}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>`;
    out += `<circle cx="${CX}" cy="${CY}" r="${ro}" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>`;
    for (let m = 0; m < 60; m += 10) {
      const [x, y] = polar(CX, CY, (ri + ro) / 2, m * DEG);
      out += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.30)" font-weight="600" font-family="${FONT}">${c === 1 ? m : m + 60}</text>`;
    }
    out += `<text x="${CX}" y="${CY - ri + 14}" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.42)" font-family="${FONT}">${label}</text>`;
  }

  // [circle, localStart, localEnd, color, label, isSelected]
  const segs = [
    [1, 38, 46, '#ef4444', 'Betrayal', false],
    [2, 12, 25, '#f97316', 'False Victory', false],
    [2, 40, 52, '#22c55e', 'Redemption', false],
    [1, 12, 24, '#3b82f6', "The Mentor's Gift", true],
  ];
  const mids = {};
  for (const [c, ls, le] of segs) {
    mids[segs.find((s) => s[0] === c && s[1] === ls)[4]] = mid(c, ls, le);
  }

  // Wires (connected to selected segment stay bright; others dimmed)
  const arrow = (x1, y1, x2, y2) => {
    const a = Math.atan2(y2 - y1, x2 - x1), s = 9, a1 = a - Math.PI / 6, a2 = a + Math.PI / 6;
    return `${x2},${y2} ${x2 - s * Math.cos(a1)},${y2 - s * Math.sin(a1)} ${x2 - s * Math.cos(a2)},${y2 - s * Math.sin(a2)}`;
  };
  for (const [f, t, isConn] of [
    ['Betrayal', 'Redemption', false],
    ['False Victory', 'Redemption', false],
    ["The Mentor's Gift", 'False Victory', true],
  ]) {
    const [x1, y1] = mids[f], [x2, y2] = mids[t];
    const rawColor = segs.find((s) => s[4] === f)[3];
    const color = isConn ? rawColor : grayOutColor(rawColor);
    const op = isConn ? 0.95 : 0.16;
    const sw = isConn ? 2.2 : 1.1;
    out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" stroke-opacity="${op}"/>`;
    out += `<circle cx="${x1}" cy="${y1}" r="${isConn ? 4.5 : 3}" fill="${color}" fill-opacity="${op}"/>`;
    out += `<polygon points="${arrow(x1, y1, x2, y2)}" fill="${color}" fill-opacity="${op}" stroke="${color}" stroke-opacity="${op}" stroke-linejoin="round"/>`;
  }

  // Render segments (dimmed first, selected on top with glow)
  for (const [c, ls, le, color, label, sel] of segs) {
    const ri = c === 1 ? R1I : R2I, ro = c === 1 ? R1O : R2O;
    if (sel) {
      out += `<path d="${sector(CX, CY, ri, ro, ls * DEG, (le + 1) * DEG)}" fill="none" stroke="${color}" stroke-width="5" stroke-opacity="0.35"/>`;
    }
    const d = sector(CX, CY, sel ? ri + 2 : ri + 4, sel ? ro - 2 : ro - 4, ls * DEG, (le + 1) * DEG);
    const fill = sel ? color : grayOutColor(color);
    const op = sel ? 0.98 : 0.22;
    out += `<path d="${d}" fill="${fill}" fill-opacity="${op}" stroke="${sel ? '#ffffff' : 'rgba(128,128,128,0.22)'}" stroke-width="${sel ? 2.5 : 1}"/>`;
    const [x, y] = mids[label];
    out += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-size="${sel ? 11.5 : 11}" font-weight="700" fill="${sel ? '#ffffff' : '#9ca3af'}" opacity="${sel ? 1 : 0.42}" font-family="${FONT}">${esc(label)}</text>`;
  }

  // Center hub showing focused segment
  out += `<circle cx="${CX}" cy="${CY}" r="42" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;
  out += `<text x="${CX}" y="${CY - 3}" text-anchor="middle" font-size="10" font-weight="700" fill="#dcddde" font-family="${FONT}">The Mentor's…</text>`;
  out += `<text x="${CX}" y="${CY + 11}" text-anchor="middle" font-size="9" fill="#8a8a8a" font-family="${FONT}">C1 · 12'–24'</text>`;
  return out;
}

// ---------------------------------------------------------------------------
// Helpers for the UI panels
// ---------------------------------------------------------------------------
const label = (x, y, s) =>
  `<text x="${x}" y="${y}" font-size="10" font-weight="700" letter-spacing="1.2" fill="${C.muted}" font-family="${FONT}">${esc(s.toUpperCase())}</text>`;

const field = (x, y, w, h, value, opts = {}) => {
  const fill = opts.fill ?? C.input;
  const textFill = opts.placeholder ? C.muted : C.text;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${fill}" stroke="${C.border}"/>`
    + `<text x="${x + 12}" y="${y + h / 2 + 4}" font-size="12.5" fill="${textFill}" font-family="${FONT}">${esc(value)}</text>`;
};

const btn = (x, y, w, h, s, kind = 'normal') => {
  if (kind === 'primary') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${C.accent}"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff" font-family="${FONT}">${esc(s)}</text>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="none" stroke="${C.border}"/><text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="11.5" fill="${C.text}" font-family="${FONT}">${esc(s)}</text>`;
};

// ---------------------------------------------------------------------------
// 1. Editor screenshot (with color picker circle, bottom segments tray, highlight)
// ---------------------------------------------------------------------------
function editorSVG() {
  const W = 1240, H = 780, PW = 310, TRAY_H = 112;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;

  // Toolbar
  s += `<rect width="${W}" height="56" fill="${C.panel}"/><line x1="0" y1="56" x2="${W}" y2="56" stroke="${C.border}"/>`;
  s += btn(14, 13, 86, 30, '← Projects');
  s += `<text x="112" y="33" font-size="14" font-weight="700" fill="${C.text}" font-family="${FONT}">The Mentor's Arc</text>`;
  s += btn(254, 15, 165, 26, "Focused: The Mentor's Gift ✕");
  s += btn(964, 12, 76, 32, 'Paint', 'primary');
  s += btn(1048, 12, 76, 32, 'Wire');
  s += btn(1132, 12, 76, 32, 'Note');

  // Left Panel
  s += `<rect width="${PW}" height="${H - 56}" y="56" fill="${C.panel}"/><line x1="${PW}" y1="56" x2="${PW}" y2="${H}" stroke="${C.border}"/>`;
  s += label(16, 80, "Segment · C1 · 12'–24'");
  s += `<circle cx="${PW - 54}" cy="76" r="6" fill="#3b82f6"/>`;
  s += btn(PW - 40, 65, 26, 20, 'All');
  s += field(16, 90, PW - 32, 34, "The Mentor's Gift");
  s += label(16, 146, 'Title card');
  s += field(16, 152, PW - 32, 34, 'A gift given in Act I, repaid in Act III');
  s += label(16, 208, 'Annotation');
  s += `<rect x="16" y="214" width="${PW - 32}" height="64" rx="7" fill="${C.input}" stroke="${C.border}"/>`;
  s += `<text x="28" y="234" font-size="11.5" fill="${C.muted}" font-family="${FONT}">The mentor hands over the heirloom — a</text>`;
  s += `<text x="28" y="250" font-size="11.5" fill="${C.muted}" font-family="${FONT}">token the hero doesn't yet understand.</text>`;
  s += `<text x="28" y="266" font-size="11.5" fill="${C.muted}" font-family="${FONT}">Setup for the climactic reveal.</text>`;

  // Color swatches + authentic color wheel circle
  s += label(16, 300, 'Color');
  const colors = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
  colors.forEach((c, i) => {
    const cx = 26 + i * 27;
    if (c === '#3b82f6') {
      s += `<circle cx="${cx}" cy="318" r="12" fill="none" stroke="#fff" stroke-width="1.5"/><circle cx="${cx}" cy="318" r="14.5" fill="none" stroke="${C.accent}" stroke-width="2"/>`;
    }
    s += `<circle cx="${cx}" cy="318" r="9.5" fill="${c}"/>`;
  });
  // Color picker wheel at end of swatches
  const wheelX = 26 + colors.length * 27;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="11 58"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#eab308" stroke-width="2.5" stroke-dasharray="11 58" stroke-dashoffset="-11"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-dasharray="11 58" stroke-dashoffset="-22"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="11 58" stroke-dashoffset="-33"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-dasharray="11 58" stroke-dashoffset="-44"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="11" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-dasharray="14 58" stroke-dashoffset="-55"/>`;
  s += `<circle cx="${wheelX}" cy="318" r="8" fill="${C.input}"/>`;
  s += `<text x="${wheelX}" y="322" text-anchor="middle" font-size="11" font-weight="700" fill="${C.text}" font-family="${FONT}">+</text>`;

  // Linked note
  s += label(16, 354, 'Linked note');
  s += `<rect x="16" y="360" width="${PW - 32}" height="38" rx="8" fill="${C.input}" stroke="${C.border}"/>`;
  s += `<text x="28" y="384" font-size="12" fill="${C.text}" font-family="${FONT}">The Mentor's Gift.md</text>`;
  s += btn(PW - 140, 365, 50, 28, 'Open', 'primary');
  s += btn(PW - 84, 365, 42, 28, 'Chg');
  s += btn(PW - 38, 365, 20, 28, '✕');

  s += label(16, 420, 'Outgoing · payoffs');
  s += `<circle cx="22" cy="436" r="4.5" fill="#f97316"/>`;
  s += `<text x="34" y="440" font-size="12" fill="${C.text}" font-family="${FONT}">False Victory (C2 · 72'–85')</text>`;

  // Map area (top of right column)
  const mapH = H - 56 - TRAY_H;
  s += `<svg x="${PW}" y="56" width="${W - PW}" height="${mapH}" viewBox="0 0 820 820" preserveAspectRatio="xMidYMid meet">${mapInner()}</svg>`;

  // Bottom Segments Tray (below Story Clock visualization)
  const trayY = H - TRAY_H;
  s += `<rect x="${PW}" y="${trayY}" width="${W - PW}" height="${TRAY_H}" fill="${C.panel}"/>`;
  s += `<line x1="${PW}" y1="${trayY}" x2="${W}" y2="${trayY}" stroke="${C.border}"/>`;
  s += label(PW + 16, trayY + 22, 'Created Segments (4)');
  s += btn(W - 190, trayY + 8, 174, 24, 'Reset highlight (show all)');

  const chips = [
    ["The Mentor's Gift", "C1 · 12'–24'", '#3b82f6', true],
    ['Betrayal', "C1 · 38'–46'", '#ef4444', false],
    ['False Victory', "C2 · 12'–25'", '#f97316', false],
    ['Redemption', "C2 · 40'–52'", '#22c55e', false],
  ];
  let cx = PW + 16;
  const cy = trayY + 42;
  for (const [name, rng, col, sel] of chips) {
    const cw = name.length * 7 + rng.length * 6 + 52;
    const stroke = sel ? C.accent : C.border;
    const sw = sel ? 2 : 1;
    const op = sel ? 1 : 0.45;
    s += `<g opacity="${op}">`;
    s += `<rect x="${cx}" y="${cy}" width="${cw}" height="32" rx="16" fill="${C.input}" stroke="${stroke}" stroke-width="${sw}"/>`;
    s += `<circle cx="${cx + 15}" cy="${cy + 16}" r="5" fill="${col}"/>`;
    s += `<text x="${cx + 26}" y="${cy + 20}" font-size="12" font-weight="${sel ? 700 : 500}" fill="${C.text}" font-family="${FONT}">${esc(name)}</text>`;
    s += `<text x="${cx + cw - 12}" y="${cy + 20}" text-anchor="end" font-size="10.5" fill="${C.muted}" font-family="${FONT}">${esc(rng)}</text>`;
    s += `</g>`;
    cx += cw + 10;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

// ---------------------------------------------------------------------------
// 2. Projects screenshot
// ---------------------------------------------------------------------------
function projectsSVG() {
  const W = 760, H = 560;
  let s = `<rect width="${W}" height="${H}" fill="${C.bg}"/>`;
  s += `<text x="40" y="56" font-size="22" font-weight="800" letter-spacing="2" fill="${C.text}" font-family="${FONT}">CIRCLE MAP</text>`;
  s += `<text x="40" y="74" font-size="11" letter-spacing="3" fill="${C.muted}" font-family="${FONT}">STORY CLOCK · PROJECTS</text>`;
  s += `<rect x="40" y="100" width="520" height="44" rx="8" fill="${C.input}" stroke="${C.border}"/>`;
  s += `<text x="56" y="127" font-size="13" fill="${C.muted}" font-family="${FONT}">New project name…</text>`;
  s += btn(572, 100, 148, 44, 'Create', 'primary');
  s += label(40, 176, 'Projects · 3');
  const cards = [
    ["The Mentor's Arc", '6 segments · 9 wires', 'Today 18:42'],
    ['Second Draft — Thriller', '14 segments · 21 wires', 'Yesterday 22:10'],
    ['Short — 15 min', '3 segments · 2 wires', 'Oct 12'],
  ];
  let cy = 190;
  for (const [name, meta, when] of cards) {
    s += `<rect x="40" y="${cy}" width="${W - 80}" height="104" rx="12" fill="${C.panel}" stroke="${C.border}"/>`;
    s += `<text x="60" y="${cy + 30}" font-size="15" font-weight="700" fill="${C.text}" font-family="${FONT}">${esc(name)}</text>`;
    s += `<text x="60" y="${cy + 48}" font-size="11" fill="${C.muted}" font-family="${FONT}">${meta}</text>`;
    s += `<text x="${W - 60}" y="${cy + 30}" text-anchor="end" font-size="11" fill="${C.muted}" font-family="${FONT}">${when}</text>`;
    s += btn(60, cy + 62, 62, 28, 'Open', 'primary');
    s += btn(130, cy + 62, 72, 28, 'Rename');
    s += btn(210, cy + 62, 82, 28, 'Duplicate');
    s += btn(300, cy + 62, 72, 28, 'Export');
    s += btn(380, cy + 62, 66, 28, 'Delete');
    cy += 116;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render(name, svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: 2 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  });
  const png = resvg.render().asPng();
  writeFileSync(`docs/${name}.png`, png);
  console.log(`wrote docs/${name}.png (${png.length} bytes)`);
}

render('screenshot-editor', editorSVG());
render('screenshot-projects', projectsSVG());
console.log('done');
