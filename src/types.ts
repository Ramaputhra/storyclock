// Data model for the Story Clock plugin. Self-contained (not shared with the
// desktop app), but the JSON shape matches so projects are portable.

export interface NoteLink {
  /** Vault-relative path (normalized) of the linked note. */
  path: string;
  /** Note title (basename). */
  title: string;
}

export interface Segment {
  id: string;
  text: string;
  start: number; // absolute minute 0..119
  end: number; // absolute minute, inclusive
  circle: 1 | 2;
  color: string;
  note: string;
  titleCard?: string;
  noteLink?: NoteLink | null;
}

export interface Wire {
  id: string;
  from: string;
  to: string;
}

export interface MinuteNote {
  minute: number; // 0..119
  noteLink: NoteLink;
}

export interface Project {
  id: string;
  name: string;
  segments: Segment[];
  wires: Wire[];
  minuteNotes: MinuteNote[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  segmentCount: number;
  wireCount: number;
}

export function createProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: randomId(),
    name,
    segments: [],
    wires: [],
    minuteNotes: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createSegment(
  circle: 1 | 2,
  start: number,
  end: number,
  color: string,
  text: string,
): Segment {
  return {
    id: randomId(),
    text,
    start,
    end,
    circle,
    color,
    note: '',
    titleCard: '',
    noteLink: null,
  };
}

export function segmentRange(seg: Segment): string {
  const ls = seg.circle === 1 ? seg.start : seg.start - 60;
  const le = seg.circle === 1 ? seg.end : seg.end - 60;
  return `C${seg.circle} · ${ls}'–${le}'`;
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
