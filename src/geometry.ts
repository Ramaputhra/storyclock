// Geometry for the two-ring story clock. Self-contained.

export const SEGMENTS_PER_RING = 60;
export const TOTAL_MINUTES = 120;
export const DEG_PER_MINUTE = 360 / SEGMENTS_PER_RING;

export const PALETTE = [
  '#111827',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#78716c',
];

export const VIEWBOX = 820;
export const CX = VIEWBOX / 2;
export const CY = VIEWBOX / 2;

export const R1_INNER = 150;
export const R1_OUTER = 226;
export const R2_INNER = 260;
export const R2_OUTER = 336;

export interface RingDef {
  circle: 1 | 2;
  label: string;
  inner: number;
  outer: number;
}

export const RINGS: RingDef[] = [
  { circle: 1, label: 'ACT I · 0–60', inner: R1_INNER, outer: R1_OUTER },
  { circle: 2, label: 'ACT II · 60–120', inner: R2_INNER, outer: R2_OUTER },
];

export function ringFor(circle: 1 | 2): RingDef {
  return RINGS[circle - 1];
}

export function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

export function clockAngle(cx: number, cy: number, x: number, y: number): number {
  const a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  return (a + 90 + 360) % 360;
}

export function minuteAtAngle(angleDeg: number): number {
  return Math.floor(((angleDeg + 360) % 360) / DEG_PER_MINUTE) % SEGMENTS_PER_RING;
}

export function hitRing(x: number, y: number): 1 | 2 | null {
  const dx = x - CX;
  const dy = y - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d >= R1_INNER && d <= R1_OUTER) return 1;
  if (d >= R2_INNER && d <= R2_OUTER) return 2;
  return null;
}

export function minuteAtPoint(x: number, y: number): number | null {
  const circle = hitRing(x, y);
  if (circle === null) return null;
  const local = minuteAtAngle(clockAngle(CX, CY, x, y));
  return circle === 1 ? local : 60 + local;
}

export function annularSectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  a0: number,
  a1: number,
): string {
  const p0i = polarPoint(cx, cy, rInner, a0);
  const p1i = polarPoint(cx, cy, rInner, a1);
  const p1o = polarPoint(cx, cy, rOuter, a1);
  const p0o = polarPoint(cx, cy, rOuter, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${p0i.x} ${p0i.y}`,
    `A ${rInner} ${rInner} 0 ${large} 1 ${p1i.x} ${p1i.y}`,
    `L ${p1o.x} ${p1o.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 0 ${p0o.x} ${p0o.y}`,
    'Z',
  ].join(' ');
}

export function rangeMidpoint(circle: 1 | 2, startLocal: number, endLocal: number) {
  const ring = ringFor(circle);
  const midAngle = ((startLocal + endLocal + 1) / 2) * DEG_PER_MINUTE;
  const r = (ring.inner + ring.outer) / 2;
  return polarPoint(CX, CY, r, midAngle);
}

export function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#111827' : '#ffffff';
}

/** Desaturate a hex color toward neutral gray when another segment is focused. */
export function grayOutColor(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return '#6b7280';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const mix = (c: number) => Math.round(c * 0.18 + gray * 0.42 + 105 * 0.4);
  const toHex = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

