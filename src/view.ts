// Story Clock view: renders the circle map inside Obsidian and wires note
// mapping (link existing note by title, create title-card note, open in side
// panel). Self-contained vanilla DOM — no framework.

import { ItemView, Notice, WorkspaceLeaf, TFile, normalizePath } from 'obsidian';
import type StoryClockPlugin from './main';
import type { Project, Segment, NoteLink } from './types';
import { createSegment, segmentRange, randomId } from './types';
import {
  VIEWBOX,
  CX,
  CY,
  RINGS,
  DEG_PER_MINUTE,
  SEGMENTS_PER_RING,
  PALETTE,
  clockAngle,
  minuteAtAngle,
  minuteAtPoint,
  hitRing,
  annularSectorPath,
  rangeMidpoint,
  polarPoint,
  ringFor,
  contrastText,
  grayOutColor,
} from './geometry';
import {
  listProjects,
  loadProject,
  saveProject,
  createProjectFile,
  duplicateProjectFile,
  deleteProjectFile,
} from './storage';
import { NoteLinkModal, fileToLink } from './notePicker';

export const VIEW_TYPE = 'story-clock-view';
type Mode = 'paint' | 'wire' | 'note';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(tag: string, attrs: Record<string, unknown> = {}, children: (Node | string)[] = []): HTMLElement {
  const e = createEl(tag as keyof HTMLElementTagNameMap);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v as string;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' || k === 'placeholder' || k === 'textContent' || k === 'type' || k === 'rows' || k === 'disabled' || k === 'title') (e as unknown as Record<string, unknown>)[k] = v;
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') e.setAttribute(k, String(v));
  }
  for (const c of children) if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function svgEl(tag: string, attrs: Record<string, unknown> = {}, children: SVGElement[] = []): SVGElement {
  const e = createSvg(tag as keyof SVGElementTagNameMap);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') e.setAttribute(k, String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

function svgText(x: number, y: number, s: string, attrs: Record<string, unknown> = {}): SVGElement {
  const t = svgEl('text', { x, y, ...attrs });
  t.textContent = s;
  return t;
}

function normalizeHex(color: string): string {
  const c = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return (
      '#' +
      c
        .slice(1)
        .split('')
        .map((ch) => ch + ch)
        .join('')
        .toLowerCase()
    );
  }
  return '#3b82f6';
}

function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|#^[\]]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned || 'Untitled Segment';
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export class StoryClockView extends ItemView {
  private plugin: StoryClockPlugin;

  private project: Project | null = null;
  private mode: Mode = 'paint';
  private selectedId: string | null = null;
  private pending: { circle: 1 | 2; start: number; end: number } | null = null;
  private pendingColor = PALETTE[6];
  private wireFrom: string | null = null;
  private drag: { type: 'paint' | 'wire'; circle?: 1 | 2; anchor?: number; fromId?: string; moved?: boolean } | null = null;
  private preview: { x: number; y: number } | null = null;

  private saveTimer: number | null = null;

  private toolbarEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private mapWrapEl: HTMLElement | null = null;
  private trayEl: HTMLElement | null = null;
  private svgEl: SVGSVGElement | null = null;
  private pendingPathEl: SVGElement | null = null;
  private pendingRangeEl: HTMLElement | null = null;
  private pendingDotEl: HTMLElement | null = null;
  private previewLineEl: SVGElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: StoryClockPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'Story circle';
  }
  getIcon(): string {
    return 'timer';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.project) {
      await saveProject(this.app, this.project);
    }
  }

  // ---- state helpers ------------------------------------------------------

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (this.project) void saveProject(this.app, this.project);
    }, 500);
  }

  private refreshMapOnly(): void {
    if (this.mapWrapEl) {
      this.mapWrapEl.empty();
      this.buildMap(this.mapWrapEl);
    }
  }

  private refreshTrayOnly(): void {
    if (this.trayEl) {
      this.trayEl.empty();
      this.buildBottomTray(this.trayEl);
    }
  }

  private refreshPanelOnly(): void {
    if (this.panelEl) {
      this.panelEl.empty();
      this.buildPanel(this.panelEl);
    }
  }

  private refreshAll(): void {
    this.render();
  }

  /**
   * Select a segment (from either the circle or the segments list), highlight
   * it on the circle while graying out all other segments, and open its linked
   * note in the configured pane.
   */
  private selectSegment(id: string | null, openNote = true): void {
    this.selectedId = id;
    if (id) this.pending = null;
    this.refreshAll();
    if (id && openNote) {
      const seg = this.project?.segments.find((s) => s.id === id);
      if (seg?.noteLink) {
        void this.openNoteLink(seg.noteLink);
      }
    }
  }

  // ---- top-level render ---------------------------------------------------

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass('story-clock-view');

    if (!this.project) {
      this.buildProjectList(c);
    } else {
      this.buildEditor(c);
    }
  }

  // ---- project list screen ------------------------------------------------

  private buildProjectList(container: HTMLElement): void {
    const root = el('div', { style: { padding: '16px', overflowY: 'auto', height: '100%' } });
    container.appendChild(root);

    const topHead = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' } });
    topHead.appendChild(el('h2', { style: { margin: '0' } }, ['Story Circle']));
    topHead.appendChild(
      el('button', {
        class: 'story-clock-btn',
        style: { fontSize: '11px', padding: '4px 9px' },
        title: 'Support the author on Buy Me a Coffee (https://buymeacoffee.com/ramaputhra)',
        onclick: () => window.open('https://buymeacoffee.com/ramaputhra', '_blank', 'noopener,noreferrer'),
      }, ['☕ Buy me a coffee']),
    );
    root.appendChild(topHead);
    root.appendChild(
      el('div', { class: 'story-clock-label', style: { marginTop: '0' } }, ['Projects']),
    );

    const newRow = el('div', { style: { display: 'flex', gap: '8px', margin: '8px 0 16px' } });
    const nameInput = el('input', {
      class: 'story-clock-input',
      type: 'text',
      placeholder: 'New project name…',
      style: { flex: '1' },
    }) as HTMLInputElement;
    nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void this.createProject(nameInput.value);
    });
    newRow.appendChild(nameInput);
    newRow.appendChild(
      el('button', {
        class: 'story-clock-btn primary',
        onclick: () => {
          void this.createProject(nameInput.value);
        },
      }, ['Create']),
    );
    root.appendChild(newRow);

    const list = el('div');
    root.appendChild(list);

    void listProjects(this.app).then((projects) => {
      list.empty();
      if (projects.length === 0) {
        list.appendChild(el('div', { class: 'story-clock-label', style: { textTransform: 'none' } }, ['No projects yet. Create one above to begin mapping.']));
        return;
      }
      for (const meta of projects) {
        list.appendChild(this.projectCard(meta.id, meta.name, meta.segmentCount, meta.wireCount));
      }
    });
  }

  private projectCard(id: string, name: string, segments: number, wires: number): HTMLElement {
    const card = el('div', {
      style: {
        border: '1px solid var(--background-modifier-border)',
        borderRadius: '8px',
        padding: '10px 12px',
        marginBottom: '8px',
      },
    });

    const head = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } });
    const title = el('div', { style: { fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [name]);
    const count = el('div', { style: { color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap' } }, [`${segments} seg · ${wires} wires`]);
    head.appendChild(title);
    head.appendChild(count);
    card.appendChild(head);

    const actions = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } });
    actions.appendChild(el('button', { class: 'story-clock-btn primary', onclick: () => void this.openProject(id) }, ['Open']));
    actions.appendChild(el('button', { class: 'story-clock-btn', onclick: () => void this.renameProject(id) }, ['Rename']));
    actions.appendChild(el('button', { class: 'story-clock-btn', onclick: () => void this.duplicateProject(id) }, ['Duplicate']));
    actions.appendChild(el('button', { class: 'story-clock-btn danger', onclick: () => void this.deleteProject(id, name) }, ['Delete']));
    card.appendChild(actions);

    return card;
  }

  private async createProject(name: string): Promise<void> {
    const p = await createProjectFile(this.app, name.trim() || 'Untitled project');
    this.project = p;
    this.selectedId = null;
    this.pending = null;
    this.wireFrom = null;
    this.pendingColor = this.nextColor();
    this.refreshAll();
  }

  private async openProject(id: string): Promise<void> {
    const p = await loadProject(this.app, id);
    if (p) {
      this.project = p;
      this.selectedId = null;
      this.pending = null;
      this.wireFrom = null;
      this.pendingColor = this.nextColor();
      this.refreshAll();
    }
  }

  private async renameProject(id: string): Promise<void> {
    const p = await loadProject(this.app, id);
    if (!p) return;
    const current = p.name;
    const modal = el('div', {
      style: {
        position: 'fixed', inset: '0', zIndex: '99999',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      },
    });
    const box = el('div', {
      style: {
        background: 'var(--background-primary)', padding: '20px', borderRadius: '10px',
        width: '320px', border: '1px solid var(--background-modifier-border)',
      },
    });
    box.appendChild(el('div', { style: { fontWeight: 600, marginBottom: '10px' } }, ['Rename project']));
    const input = el('input', { class: 'story-clock-input', value: current }) as HTMLInputElement;
    box.appendChild(input);
    const btns = el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' } });
    btns.appendChild(el('button', { class: 'story-clock-btn', onclick: () => modal.remove() }, ['Cancel']));
    btns.appendChild(el('button', { class: 'story-clock-btn primary', onclick: async () => {
      p.name = input.value.trim() || current;
      await saveProject(this.app, p);
      modal.remove();
      this.refreshAll();
    } }, ['Save']));
    box.appendChild(btns);
    modal.appendChild(box);
    document.body.appendChild(modal);
    input.focus();
  }

  private async duplicateProject(id: string): Promise<void> {
    const clone = await duplicateProjectFile(this.app, id);
    if (clone) {
      this.project = clone;
      this.selectedId = null;
      this.pending = null;
      this.wireFrom = null;
      this.pendingColor = this.nextColor();
      this.refreshAll();
    }
  }

  private async deleteProject(id: string, name: string): Promise<void> {
    const modal = el('div', {
      style: {
        position: 'fixed', inset: '0', zIndex: '99999',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      },
    });
    const box = el('div', {
      style: {
        background: 'var(--background-primary)', padding: '20px', borderRadius: '10px', width: '320px',
        border: '1px solid var(--background-modifier-border)',
      },
    });
    box.appendChild(el('div', { style: { marginBottom: '12px' } }, [`Delete "${name}"? This cannot be undone.`]));
    const btns = el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } });
    btns.appendChild(el('button', { class: 'story-clock-btn', onclick: () => modal.remove() }, ['Cancel']));
    btns.appendChild(el('button', { class: 'story-clock-btn danger', onclick: async () => {
      await deleteProjectFile(this.app, id);
      modal.remove();
      this.refreshAll();
    } }, ['Delete']));
    box.appendChild(btns);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  // ---- editor --------------------------------------------------------------

  private buildEditor(container: HTMLElement): void {
    // Toolbar
    this.toolbarEl = el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 10px', borderBottom: '1px solid var(--background-modifier-border)',
        flexWrap: 'wrap',
      },
    });
    container.appendChild(this.toolbarEl);

    this.toolbarEl.appendChild(el('button', { class: 'story-clock-btn', onclick: () => this.backToList() }, ['← Projects']));
    this.toolbarEl.appendChild(
      el('span', { style: { fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' } }, [this.project?.name ?? '']),
    );

    if (this.selectedId) {
      const selSeg = this.project?.segments.find((s) => s.id === this.selectedId);
      if (selSeg) {
        this.toolbarEl.appendChild(
          el('button', {
            class: 'story-clock-btn',
            style: { fontSize: '11px', padding: '3px 8px' },
            title: 'Show all segments in full color',
            onclick: () => this.selectSegment(null, false),
          }, [`Focused: ${selSeg.text.slice(0, 16)} ✕`]),
        );
      }
    }

    const modeGroup = el('div', { style: { display: 'flex', gap: '4px', marginLeft: 'auto' } });
    (['paint', 'wire', 'note'] as Mode[]).forEach((m) => {
      modeGroup.appendChild(
        el('button', {
          class: `story-clock-btn${this.mode === m ? ' active' : ''}`,
          onclick: () => {
            this.mode = m;
            this.refreshAll();
          },
        }, [m === 'paint' ? 'Paint' : m === 'wire' ? 'Wire' : 'Note']),
      );
    });
    this.toolbarEl.appendChild(modeGroup);

    // Body: Left control panel + Right column (Clock visualization on top, Segments tray below)
    const body = el('div', { style: { display: 'flex', flex: '1', minHeight: '0' } });
    container.appendChild(body);

    this.panelEl = el('div', {
      style: {
        width: '295px', minWidth: '250px', borderRight: '1px solid var(--background-modifier-border)',
        padding: '12px', overflowY: 'auto', flexShrink: '0',
      },
    });
    body.appendChild(this.panelEl);

    const rightCol = el('div', {
      style: {
        flex: '1', minWidth: '0', minHeight: '0',
        display: 'flex', flexDirection: 'column',
      },
    });
    body.appendChild(rightCol);

    this.mapWrapEl = el('div', {
      style: {
        flex: '1', minWidth: '0', minHeight: '0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px',
      },
    });
    rightCol.appendChild(this.mapWrapEl);

    this.trayEl = el('div', { class: 'story-clock-tray' });
    rightCol.appendChild(this.trayEl);

    this.buildPanel(this.panelEl);
    this.buildMap(this.mapWrapEl);
    this.buildBottomTray(this.trayEl);
  }

  private backToList(): void {
    void (async () => {
      if (this.saveTimer !== null) {
        window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      if (this.project) await saveProject(this.app, this.project);
      this.project = null;
      this.selectedId = null;
      this.pending = null;
      this.wireFrom = null;
      this.refreshAll();
    })();
  }

  // ---- Color swatches + compact authentic color picker ---------------------

  private buildColorPickerRow(
    currentColor: string,
    onColorChange: (color: string, isLiveDrag: boolean) => void,
  ): HTMLElement {
    const normCurrent = normalizeHex(currentColor);
    const isPaletteColor = PALETTE.some((p) => p.toLowerCase() === normCurrent);

    const swatches = el('div', { class: 'story-clock-swatches' });
    for (const c of PALETTE) {
      const isSel = c.toLowerCase() === normCurrent;
      swatches.appendChild(
        el('span', {
          class: `story-clock-swatch${isSel ? ' selected' : ''}`,
          style: { background: c },
          title: c,
          onclick: () => onColorChange(c, false),
        }),
      );
    }

    // Small authentic color-wheel circle at the end of the palette circles
    const pickerWrap = el('label', {
      class: `story-clock-color-picker${!isPaletteColor ? ' selected' : ''}`,
      title: `Custom color (${normCurrent}) — click to pick any color`,
    });
    const innerDot = el('span', {
      class: 'story-clock-color-picker-inner',
      style: !isPaletteColor
        ? { background: normCurrent, color: contrastText(normCurrent) }
        : {},
    }, [!isPaletteColor ? '✓' : '+']);

    const colorInput = el('input', {
      type: 'color',
      value: normCurrent,
      title: 'Choose custom color',
    }) as HTMLInputElement;

    colorInput.addEventListener('input', () => {
      const picked = normalizeHex(colorInput.value);
      innerDot.style.background = picked;
      innerDot.style.color = contrastText(picked);
      innerDot.textContent = '✓';
      pickerWrap.classList.add('selected');
      swatches.querySelectorAll('.story-clock-swatch.selected').forEach((s) => s.classList.remove('selected'));
      onColorChange(picked, true);
    });

    colorInput.addEventListener('change', () => {
      const picked = normalizeHex(colorInput.value);
      onColorChange(picked, false);
    });

    pickerWrap.appendChild(innerDot);
    pickerWrap.appendChild(colorInput);
    swatches.appendChild(pickerWrap);

    return swatches;
  }

  // ---- panel ---------------------------------------------------------------

  private buildPanel(container: HTMLElement): void {
    const p = this.project;
    if (!p) return;

    if (this.pending) {
      const ls = this.pending.circle === 1 ? this.pending.start : this.pending.start - 60;
      const le = this.pending.circle === 1 ? this.pending.end : this.pending.end - 60;
      const range = `C${this.pending.circle} · ${ls}'–${le}'`;

      const headRow = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } });
      this.pendingRangeEl = el('div', { class: 'story-clock-label', style: { margin: '0' } }, [`New selection · ${range}`]);
      this.pendingDotEl = el('span', {
        style: { width: '12px', height: '12px', borderRadius: '50%', background: this.pendingColor, flexShrink: '0' },
      });
      headRow.appendChild(this.pendingRangeEl);
      headRow.appendChild(this.pendingDotEl);
      container.appendChild(headRow);

      const nameInput = el('input', {
        class: 'story-clock-input',
        placeholder: 'Theme / segment name…',
        type: 'text',
      }) as HTMLInputElement;
      container.appendChild(nameInput);

      container.appendChild(el('div', { class: 'story-clock-label' }, ['Title card']));
      const titleCardInput = el('input', {
        class: 'story-clock-input',
        placeholder: 'Title card (note title & heading)…',
        type: 'text',
      }) as HTMLInputElement;
      container.appendChild(titleCardInput);

      container.appendChild(el('div', { class: 'story-clock-label' }, ['Annotation']));
      const noteInput = el('textarea', {
        class: 'story-clock-textarea',
        placeholder: 'Setup statement, emotional beat…',
      }) as HTMLTextAreaElement;
      container.appendChild(noteInput);

      container.appendChild(el('div', { class: 'story-clock-label' }, ['Color']));
      container.appendChild(
        this.buildColorPickerRow(this.pendingColor, (pickedColor, isLiveDrag) => {
          this.pendingColor = pickedColor;
          if (this.pendingDotEl) this.pendingDotEl.style.background = pickedColor;
          if (this.pendingPathEl) {
            this.pendingPathEl.setAttribute('fill', pickedColor);
            this.pendingPathEl.setAttribute('stroke', pickedColor);
          }
          this.refreshTrayOnly();
          if (!isLiveDrag) {
            // Preserve typed text when re-rendering swatches
            const curName = nameInput.value;
            const curTitle = titleCardInput.value;
            const curNote = noteInput.value;
            this.refreshPanelOnly();
            const inputs = this.panelEl?.querySelectorAll('input.story-clock-input');
            const area = this.panelEl?.querySelector('textarea.story-clock-textarea') as HTMLTextAreaElement | null;
            if (inputs && inputs[0]) (inputs[0] as HTMLInputElement).value = curName;
            if (inputs && inputs[1]) (inputs[1] as HTMLInputElement).value = curTitle;
            if (area) area.value = curNote;
          }
        }),
      );

      const commitNewSegment = async (andCreateNote: boolean) => {
        if (!this.pending) return;
        const rawName = nameInput.value.trim();
        const rawTitleCard = titleCardInput.value.trim();
        const finalName = rawName || rawTitleCard || 'Untitled segment';
        const seg = this.addSegment(
          this.pending.circle,
          this.pending.start,
          this.pending.end,
          finalName,
          this.pendingColor,
          rawTitleCard,
          noteInput.value,
        );
        if (andCreateNote && seg) {
          await this.createNoteForSegment(seg);
        }
      };

      nameInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') void commitNewSegment(ev.shiftKey);
        if (ev.key === 'Escape') { this.pending = null; this.refreshAll(); }
      });
      titleCardInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') void commitNewSegment(true);
        if (ev.key === 'Escape') { this.pending = null; this.refreshAll(); }
      });

      const btns = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' } });
      const topRow = el('div', { style: { display: 'flex', gap: '6px' } });
      topRow.appendChild(
        el('button', {
          class: 'story-clock-btn primary',
          style: { flex: '1' },
          onclick: () => void commitNewSegment(false),
        }, ['Create Segment']),
      );
      topRow.appendChild(
        el('button', {
          class: 'story-clock-btn',
          onclick: () => { this.pending = null; this.refreshAll(); },
        }, ['Cancel']),
      );
      btns.appendChild(topRow);

      btns.appendChild(
        el('button', {
          class: 'story-clock-btn secondary-accent',
          style: { width: '100%' },
          title: 'Create this segment and immediately create & open its Title-Card Note in your Obsidian vault',
          onclick: () => void commitNewSegment(true),
        }, ['+ Create New Title-Card Note']),
      );

      container.appendChild(btns);
      this.segmentListHint(container);
      return;
    }

    const seg = this.selectedId ? p.segments.find((s) => s.id === this.selectedId) : null;

    if (seg) {
      this.buildSegmentEditor(container, seg);
      return;
    }

    // Empty state help
    container.appendChild(el('div', { class: 'story-clock-label', style: { marginTop: '0' } }, [this.mode === 'paint' ? 'Paint mode' : this.mode === 'wire' ? 'Wire mode' : 'Note mode']));
    const help =
      this.mode === 'paint'
        ? 'Drag on a ring to select minutes, then name the theme, pick any color, or create a Title-Card note.'
        : this.mode === 'wire'
          ? 'Drag one block to another to connect setup → payoff.'
          : 'Click a segment or a minute to link it to a note.';
    container.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' } }, [help]));
    this.segmentListHint(container);
  }

  private segmentListHint(container: HTMLElement): void {
    const p = this.project;
    if (!p || p.segments.length === 0) return;
    container.appendChild(el('div', { class: 'story-clock-label', style: { marginTop: '14px' } }, [`All Segments (${p.segments.length})`]));
    const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
    for (const seg of p.segments) {
      const isSel = this.selectedId === seg.id;
      const row = el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
          padding: '4px 6px', borderRadius: '5px', cursor: 'pointer',
          background: isSel ? 'var(--background-modifier-hover)' : 'transparent',
          opacity: this.selectedId && !isSel ? '0.55' : '1',
        },
        onclick: () => this.selectSegment(isSel ? null : seg.id, !isSel),
      });
      row.appendChild(el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: seg.color, flexShrink: '0' } }));
      row.appendChild(el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1', fontWeight: isSel ? '600' : '400' } }, [seg.text || 'Untitled']));
      if (seg.noteLink) {
        row.appendChild(el('span', { style: { fontSize: '10px' }, title: `Linked: ${seg.noteLink.title}` }, ['📄']));
      }
      row.appendChild(el('span', { style: { color: 'var(--text-muted)', fontSize: '10px', whiteSpace: 'nowrap' } }, [segmentRange(seg).split('·')[1]?.trim() ?? '']));
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  private buildSegmentEditor(container: HTMLElement, seg: Segment): void {
    const headRow = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
    headRow.appendChild(el('div', { class: 'story-clock-label', style: { margin: '0' } }, [`Segment · ${segmentRange(seg)}`]));
    const rightHead = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
    rightHead.appendChild(el('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: seg.color } }));
    rightHead.appendChild(
      el('button', {
        class: 'story-clock-btn',
        style: { padding: '2px 6px', fontSize: '10px' },
        title: 'Clear selection & un-dim other segments',
        onclick: () => this.selectSegment(null, false),
      }, ['All']),
    );
    headRow.appendChild(rightHead);
    container.appendChild(headRow);

    const nameInput = el('input', {
      class: 'story-clock-input',
      value: seg.text,
      type: 'text',
      style: { marginTop: '6px' },
    }) as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      seg.text = nameInput.value;
      this.scheduleSave();
      this.refreshMapOnly();
      this.refreshTrayOnly();
    });
    container.appendChild(nameInput);

    container.appendChild(el('div', { class: 'story-clock-label' }, ['Title card']));
    const titleCard = el('input', {
      class: 'story-clock-input',
      value: seg.titleCard ?? '',
      placeholder: 'Title card (used for note title & heading)…',
    }) as HTMLInputElement;
    titleCard.addEventListener('input', () => {
      seg.titleCard = titleCard.value;
      this.scheduleSave();
      this.refreshTrayOnly();
    });
    container.appendChild(titleCard);

    container.appendChild(el('div', { class: 'story-clock-label' }, ['Annotation']));
    const note = el('textarea', { class: 'story-clock-textarea', placeholder: 'Setup statement, emotional beat…' }) as HTMLTextAreaElement;
    note.value = seg.note;
    note.addEventListener('input', () => { seg.note = note.value; this.scheduleSave(); });
    container.appendChild(note);

    container.appendChild(el('div', { class: 'story-clock-label' }, ['Color']));
    container.appendChild(
      this.buildColorPickerRow(seg.color, (pickedColor, isLiveDrag) => {
        seg.color = pickedColor;
        this.scheduleSave();
        if (isLiveDrag) {
          this.refreshMapOnly();
          this.refreshTrayOnly();
        } else {
          this.refreshAll();
        }
      }),
    );

    // Note mapping
    container.appendChild(el('div', { class: 'story-clock-label' }, ['Linked note']));
    if (seg.noteLink) {
      const linkRow = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginBottom: '6px' } });
      linkRow.appendChild(el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1', fontWeight: '500' } }, [`📄 ${seg.noteLink.title}`]));
      linkRow.appendChild(el('button', { class: 'story-clock-btn primary', onclick: () => void this.openNoteLink(seg.noteLink!) }, ['Open']));
      linkRow.appendChild(el('button', { class: 'story-clock-btn', onclick: () => this.linkNote(seg.id) }, ['Change']));
      linkRow.appendChild(el('button', { class: 'story-clock-btn danger', onclick: () => { seg.noteLink = null; this.scheduleSave(); this.refreshAll(); } }, ['✕']));
      container.appendChild(linkRow);
    } else {
      const btns = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
      btns.appendChild(el('button', { class: 'story-clock-btn primary', onclick: () => void this.createNoteForSegment(seg) }, ['+ Create New Title-Card Note']));
      btns.appendChild(el('button', { class: 'story-clock-btn', onclick: () => this.linkNote(seg.id) }, ['Link existing note…']));
      container.appendChild(btns);
    }

    // Connections
    const incoming = this.connectionsFor(seg).incoming;
    const outgoing = this.connectionsFor(seg).outgoing;
    container.appendChild(el('div', { class: 'story-clock-label' }, ['Incoming · setups']));
    if (incoming.length === 0) container.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, ['None']));
    else {
      for (const w of incoming) {
        const src = this.project!.segments.find((s) => s.id === w.from);
        const row = el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '2px 0', cursor: 'pointer' },
          onclick: () => src && this.selectSegment(src.id, true),
        });
        if (src) row.appendChild(el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: src.color } }));
        row.appendChild(el('span', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [src ? src.text : '?']));
        container.appendChild(row);
      }
    }
    container.appendChild(el('div', { class: 'story-clock-label' }, ['Outgoing · payoffs']));
    if (outgoing.length === 0) container.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, ['None']));
    else {
      for (const w of outgoing) {
        const dst = this.project!.segments.find((s) => s.id === w.to);
        const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '2px 0' } });
        if (dst) row.appendChild(el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: dst.color } }));
        row.appendChild(
          el('span', {
            style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
            onclick: () => dst && this.selectSegment(dst.id, true),
          }, [dst ? dst.text : '?']),
        );
        row.appendChild(el('button', { class: 'story-clock-btn danger', style: { padding: '2px 6px' }, onclick: () => this.deleteWire(w.id) }, ['✕']));
        container.appendChild(row);
      }
    }

    container.appendChild(el('button', {
      class: 'story-clock-btn danger',
      style: { marginTop: '12px', width: '100%' },
      onclick: () => { this.deleteSegment(seg.id); },
    }, ['Delete segment']));
  }

  private connectionsFor(seg: Segment): { incoming: { id: string; from: string; to: string }[]; outgoing: { id: string; from: string; to: string }[] } {
    const pr = this.project;
    if (!pr) return { incoming: [], outgoing: [] };
    return {
      incoming: pr.wires.filter((w) => w.to === seg.id),
      outgoing: pr.wires.filter((w) => w.from === seg.id),
    };
  }

  // ---- Bottom segments tray below the Story Clock visualization ------------

  private buildBottomTray(container: HTMLElement): void {
    const p = this.project;
    if (!p) return;

    const head = el('div', { class: 'story-clock-tray-header' });
    const leftInfo = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } });
    leftInfo.appendChild(
      el('span', { class: 'story-clock-label', style: { margin: '0' } }, [
        `Created Segments (${p.segments.length})`,
      ]),
    );

    if (this.pending) {
      const ls = this.pending.circle === 1 ? this.pending.start : this.pending.start - 60;
      const le = this.pending.circle === 1 ? this.pending.end : this.pending.end - 60;
      const creatingBadge = el('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          fontSize: '11px', fontWeight: '600', color: 'var(--text-normal)',
          background: 'var(--background-primary)', padding: '2px 8px', borderRadius: '999px',
          border: `1px dashed ${this.pendingColor}`,
        },
      });
      creatingBadge.appendChild(el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: this.pendingColor } }));
      creatingBadge.appendChild(document.createTextNode(`Creating now: C${this.pending.circle} · ${ls}'–${le}'`));
      leftInfo.appendChild(creatingBadge);
    }

    head.appendChild(leftInfo);

    const rightInfo = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });
    if (this.selectedId) {
      rightInfo.appendChild(
        el('button', {
          class: 'story-clock-btn',
          style: { padding: '2px 8px', fontSize: '11px' },
          onclick: () => this.selectSegment(null, false),
        }, ['Reset highlight (show all)']),
      );
    } else {
      rightInfo.appendChild(
        el('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, [
          'Click any segment to highlight on clock & open linked note',
        ]),
      );
    }
    head.appendChild(rightInfo);
    container.appendChild(head);

    const grid = el('div', { class: 'story-clock-tray-grid' });

    if (this.pending) {
      const ls = this.pending.circle === 1 ? this.pending.start : this.pending.start - 60;
      const le = this.pending.circle === 1 ? this.pending.end : this.pending.end - 60;
      const creatingChip = el('div', {
        class: 'story-clock-chip creating',
        title: 'Currently painting new segment — finish naming it in the left panel',
      });
      creatingChip.appendChild(
        el('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: this.pendingColor, flexShrink: '0' } }),
      );
      creatingChip.appendChild(el('span', { style: { fontWeight: '600' } }, ['New segment…']));
      creatingChip.appendChild(
        el('span', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, [`C${this.pending.circle} · ${ls}'–${le}'`]),
      );
      grid.appendChild(creatingChip);
    }

    if (p.segments.length === 0 && !this.pending) {
      grid.appendChild(
        el('div', { style: { fontSize: '11.5px', color: 'var(--text-muted)', padding: '4px 0' } }, [
          'No segments created yet — drag on the outer or inner ring above to paint your first segment.',
        ]),
      );
    } else {
      const sorted = [...p.segments].sort((a, b) => a.start - b.start);
      const hasSelection = Boolean(this.selectedId);
      for (const seg of sorted) {
        const isSel = seg.id === this.selectedId;
        const isDimmed = hasSelection && !isSel;
        const chip = el('div', {
          class: `story-clock-chip${isSel ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`,
          title: [
            `${seg.text || 'Untitled'} (${segmentRange(seg)})`,
            seg.titleCard ? `Title card: ${seg.titleCard}` : '',
            seg.noteLink ? `Note: ${seg.noteLink.title}` : 'No linked note',
          ]
            .filter(Boolean)
            .join(' • '),
          onclick: () => this.selectSegment(seg.id, true),
        });
        chip.appendChild(
          el('span', {
            style: {
              width: '10px', height: '10px', borderRadius: '50%',
              background: seg.color, flexShrink: '0',
            },
          }),
        );
        chip.appendChild(
          el('span', {
            style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, [seg.text || 'Untitled']),
        );
        chip.appendChild(
          el('span', {
            style: { fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' },
          }, [segmentRange(seg)]),
        );
        if (seg.noteLink) {
          chip.appendChild(el('span', { style: { fontSize: '10px' } }, ['📄']));
        }
        grid.appendChild(chip);
      }
    }

    container.appendChild(grid);
  }

  // ---- map -----------------------------------------------------------------

  private buildMap(container: HTMLElement): void {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${VIEWBOX} ${VIEWBOX}`,
      class: 'story-clock-map',
      style: { height: '100%', width: '100%', maxHeight: '100%' },
    }) as SVGSVGElement;

    const hasSelection = Boolean(this.selectedId);

    // ring backgrounds
    for (const ring of RINGS) {
      const g = svgEl('g');
      for (let i = 0; i < SEGMENTS_PER_RING; i++) {
        const a0 = i * DEG_PER_MINUTE;
        const a1 = (i + 1) * DEG_PER_MINUTE;
        g.appendChild(svgEl('path', {
          d: annularSectorPath(CX, CY, ring.inner, ring.outer, a0, a1),
          fill: i % 2 === 0 ? 'rgba(128,128,128,0.05)' : 'transparent',
          stroke: 'rgba(128,128,128,0.08)',
          'stroke-width': 0.5,
        }));
      }
      g.appendChild(svgEl('circle', { cx: CX, cy: CY, r: ring.inner, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.12, 'stroke-width': 1.5 }));
      g.appendChild(svgEl('circle', { cx: CX, cy: CY, r: ring.outer, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.12, 'stroke-width': 1.5 }));
      for (let m = 0; m < 60; m += 10) {
        const pt = polarPoint(CX, CY, (ring.inner + ring.outer) / 2, m * DEG_PER_MINUTE);
        g.appendChild(svgText(pt.x, pt.y + 3, String(ring.circle === 1 ? m : m + 60), {
          'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor', opacity: 0.35, 'font-weight': 600,
        }));
      }
      g.appendChild(svgText(CX, CY - ring.inner + 14, ring.label, {
        'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, 'letter-spacing': 2, fill: 'currentColor', opacity: 0.45,
      }));
      svg.appendChild(g);
    }

    // minute-note dots
    for (const mn of this.project?.minuteNotes ?? []) {
      const circle = mn.minute < 60 ? 1 : 2;
      const local = circle === 1 ? mn.minute : mn.minute - 60;
      const ring = ringFor(circle);
      const pt = polarPoint(CX, CY, ring.outer - 2, local * DEG_PER_MINUTE);
      svg.appendChild(svgEl('circle', {
        cx: pt.x, cy: pt.y, r: 6,
        fill: 'var(--interactive-accent)', stroke: 'var(--background-primary)', 'stroke-width': 2,
        opacity: hasSelection ? 0.35 : 1,
        style: { cursor: 'pointer' },
      }));
    }

    // wires (dim unrelated wires when a segment is highlighted)
    for (const w of this.project?.wires ?? []) {
      const from = this.project!.segments.find((s) => s.id === w.from);
      const to = this.project!.segments.find((s) => s.id === w.to);
      if (!from || !to) continue;
      const p1 = this.segMid(from);
      const p2 = this.segMid(to);
      const isConnected = !hasSelection || w.from === this.selectedId || w.to === this.selectedId;
      const color = isConnected ? from.color : grayOutColor(from.color);
      const opacity = !hasSelection ? 0.72 : isConnected ? 0.95 : 0.16;
      const width = !hasSelection ? 1.5 : isConnected ? 2.2 : 1.1;

      const g = svgEl('g');
      g.appendChild(svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: color, 'stroke-width': width, 'stroke-opacity': opacity }));
      g.appendChild(svgEl('line', {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: 'transparent', 'stroke-width': 14,
        style: { cursor: 'pointer' },
        onclick: () => this.deleteWire(w.id),
      }));
      g.appendChild(svgEl('circle', { cx: p1.x, cy: p1.y, r: isConnected ? 4.5 : 3, fill: color, 'fill-opacity': opacity }));
      g.appendChild(svgEl('polygon', { points: arrowPoints(p1.x, p1.y, p2.x, p2.y), fill: color, 'fill-opacity': opacity, stroke: color, 'stroke-opacity': opacity, 'stroke-linejoin': 'round' }));
      svg.appendChild(g);
    }

    // segments: render non-selected segments first, then the selected segment on top
    const allSegments = this.project?.segments ?? [];
    const orderedSegments = hasSelection
      ? [
          ...allSegments.filter((s) => s.id !== this.selectedId),
          ...allSegments.filter((s) => s.id === this.selectedId),
        ]
      : allSegments;

    for (const seg of orderedSegments) {
      const ring = ringFor(seg.circle);
      const ls = seg.circle === 1 ? seg.start : seg.start - 60;
      const le = seg.circle === 1 ? seg.end : seg.end - 60;
      const a0 = ls * DEG_PER_MINUTE;
      const a1 = (le + 1) * DEG_PER_MINUTE;
      const isSelected = seg.id === this.selectedId;
      const isDimmed = hasSelection && !isSelected;

      const innerR = isSelected ? ring.inner + 2 : ring.inner + 4;
      const outerR = isSelected ? ring.outer - 2 : ring.outer - 4;
      const d = annularSectorPath(CX, CY, innerR, outerR, a0, a1);
      const mid = rangeMidpoint(seg.circle, ls, le);
      const g = svgEl('g', { style: { cursor: 'pointer' } });

      if (isSelected) {
        // Outer glow halo on the highlighted segment
        g.appendChild(svgEl('path', {
          d: annularSectorPath(CX, CY, ring.inner, ring.outer, a0, a1),
          fill: 'none',
          stroke: seg.color,
          'stroke-width': 5,
          'stroke-opacity': 0.35,
        }));
      }

      const displayFill = isDimmed ? grayOutColor(seg.color) : seg.color;
      const displayOpacity = isSelected ? 0.98 : isDimmed ? 0.22 : 0.86;

      g.appendChild(svgEl('path', {
        d,
        fill: displayFill,
        'fill-opacity': displayOpacity,
        stroke: isSelected ? '#ffffff' : isDimmed ? 'rgba(128,128,128,0.22)' : 'transparent',
        'stroke-width': isSelected ? 2.5 : isDimmed ? 1 : 0,
      }));

      if (le - ls + 1 >= 3) {
        const label = seg.text || 'Untitled';
        g.appendChild(svgText(mid.x, mid.y + 3, label.length > 16 ? label.slice(0, 15) + '…' : label, {
          'text-anchor': 'middle',
          'font-size': isSelected ? 11.5 : 11,
          'font-weight': 700,
          fill: isDimmed ? '#9ca3af' : contrastText(seg.color),
          opacity: isDimmed ? 0.42 : 1,
        }));
      }
      svg.appendChild(g);
    }

    // Center hub (shows focused segment or total count)
    const hubG = svgEl('g', { style: { cursor: hasSelection ? 'pointer' : 'default' } });
    hubG.appendChild(svgEl('circle', {
      cx: CX, cy: CY, r: 42,
      fill: 'rgba(128,128,128,0.06)',
      stroke: 'currentColor', 'stroke-opacity': 0.14, 'stroke-width': 1,
    }));
    if (hasSelection) {
      const sel = allSegments.find((s) => s.id === this.selectedId);
      if (sel) {
        hubG.appendChild(svgText(CX, CY - 4, sel.text.length > 12 ? sel.text.slice(0, 11) + '…' : sel.text, {
          'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: 'currentColor', opacity: 0.85,
        }));
        hubG.appendChild(svgText(CX, CY + 10, segmentRange(sel), {
          'text-anchor': 'middle', 'font-size': 9, fill: 'currentColor', opacity: 0.55,
        }));
      }
    } else {
      hubG.appendChild(svgEl('circle', { cx: CX, cy: CY, r: 4, fill: 'currentColor', opacity: 0.4 }));
    }
    svg.appendChild(hubG);

    // pending paint selection (colored with pendingColor)
    if (this.pending) {
      const ring = ringFor(this.pending.circle);
      const ls = this.pending.circle === 1 ? this.pending.start : this.pending.start - 60;
      const le = this.pending.circle === 1 ? this.pending.end : this.pending.end - 60;
      const a0 = ls * DEG_PER_MINUTE;
      const a1 = (le + 1) * DEG_PER_MINUTE;
      this.pendingPathEl = svgEl('path', {
        d: annularSectorPath(CX, CY, ring.inner + 4, ring.outer - 4, a0, a1),
        fill: this.pendingColor,
        'fill-opacity': 0.45,
        stroke: this.pendingColor,
        'stroke-width': 2,
        'stroke-opacity': 0.95,
        'stroke-dasharray': '5 3',
      });
      svg.appendChild(this.pendingPathEl);
    }

    // wire preview
    if (this.wireFrom && this.preview) {
      const from = this.project?.segments.find((s) => s.id === this.wireFrom);
      if (from) {
        const p1 = this.segMid(from);
        this.previewLineEl = svgEl('line', {
          x1: p1.x, y1: p1.y, x2: this.preview.x, y2: this.preview.y,
          stroke: from.color, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'stroke-opacity': 0.8,
        });
        svg.appendChild(this.previewLineEl);
      }
    }

    // pointer events
    svg.addEventListener('pointerdown', (e: PointerEvent) => this.onPointerDown(e, svg));
    svg.addEventListener('pointermove', (e: PointerEvent) => this.onPointerMove(e, svg));
    svg.addEventListener('pointerup', (e: PointerEvent) => this.onPointerUp(e, svg));
    svg.addEventListener('pointerleave', () => {
      this.drag = null;
      this.preview = null;
    });

    container.appendChild(svg);
    this.svgEl = svg;
  }

  private segMid(seg: Segment): { x: number; y: number } {
    const ls = seg.circle === 1 ? seg.start : seg.start - 60;
    const le = seg.circle === 1 ? seg.end : seg.end - 60;
    return rangeMidpoint(seg.circle, ls, le);
  }

  private toSvg(clientX: number, clientY: number): { x: number; y: number } {
    const svg = this.svgEl;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    const p = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    return { x: p.x, y: p.y };
  }

  private segmentAt(x: number, y: number): Segment | null {
    const minute = minuteAtPoint(x, y);
    if (minute === null || !this.project) return null;
    const circle: 1 | 2 = minute < 60 ? 1 : 2;
    for (let i = this.project.segments.length - 1; i >= 0; i--) {
      const s = this.project.segments[i];
      if (s.circle === circle && minute >= s.start && minute <= s.end) return s;
    }
    return null;
  }

  private minuteNoteAt(minute: number): NoteLink | null {
    const mn = this.project?.minuteNotes.find((m) => m.minute === minute);
    return mn ? mn.noteLink : null;
  }

  // ---- pointer handling ----------------------------------------------------

  private onPointerDown(e: PointerEvent, svg: SVGSVGElement): void {
    const { x, y } = this.toSvg(e.clientX, e.clientY);
    const seg = this.segmentAt(x, y);
    const minute = minuteAtPoint(x, y);

    if (this.mode === 'note') {
      if (seg) {
        this.selectedId = seg.id;
        this.refreshAll();
        this.linkNote(seg.id);
        return;
      }
      if (minute !== null) {
        const existing = this.minuteNoteAt(minute);
        if (existing) { void this.openNoteLink(existing); return; }
        this.linkNoteToMinute(minute);
      }
      return;
    }

    if (this.mode === 'paint') {
      if (seg) {
        this.selectSegment(seg.id, true);
        return;
      }
      if (minute !== null) {
        const mn = this.minuteNoteAt(minute);
        if (mn) { void this.openNoteLink(mn); return; }
      }
      const ring = hitRing(x, y);
      if (ring) {
        this.selectedId = null;
        this.pendingColor = this.nextColor();
        this.drag = { type: 'paint', circle: ring, anchor: minute!, moved: false };
        this.pending = { circle: ring, start: minute!, end: minute! };
        this.refreshAll();
        svg.setPointerCapture(e.pointerId);
        return;
      }
      // Clicked center or outside rings → clear highlight
      this.selectSegment(null, false);
      return;
    }

    if (this.mode === 'wire') {
      if (seg) {
        this.drag = { type: 'wire', fromId: seg.id, moved: false };
        this.wireFrom = seg.id;
        this.preview = { x, y };
        this.refreshAll();
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (minute !== null) {
        const mn = this.minuteNoteAt(minute);
        if (mn) { void this.openNoteLink(mn); return; }
      }
      this.selectSegment(null, false);
    }
  }

  private onPointerMove(e: PointerEvent, _svg: SVGSVGElement): void {
    const drag = this.drag;
    if (!drag) return;
    const { x, y } = this.toSvg(e.clientX, e.clientY);

    if (drag.type === 'paint' && drag.circle !== undefined && drag.anchor !== undefined) {
      drag.moved = true;
      const angle = clockAngle(CX, CY, x, y);
      const local = minuteAtAngle(angle);
      const minute = drag.circle === 1 ? local : 60 + local;
      this.pending = {
        circle: drag.circle,
        start: Math.min(drag.anchor, minute),
        end: Math.max(drag.anchor, minute),
      };
      if (this.pendingPathEl) {
        const ring = ringFor(drag.circle);
        const ls = drag.circle === 1 ? this.pending.start : this.pending.start - 60;
        const le = drag.circle === 1 ? this.pending.end : this.pending.end - 60;
        this.pendingPathEl.setAttribute('d', annularSectorPath(CX, CY, ring.inner + 4, ring.outer - 4, ls * DEG_PER_MINUTE, (le + 1) * DEG_PER_MINUTE));
      }
      if (this.pendingRangeEl) {
        const ls = drag.circle === 1 ? this.pending.start : this.pending.start - 60;
        const le = drag.circle === 1 ? this.pending.end : this.pending.end - 60;
        this.pendingRangeEl.textContent = `New selection · C${drag.circle} · ${ls}'–${le}'`;
      }
      this.refreshTrayOnly();
    } else if (drag.type === 'wire') {
      drag.moved = true;
      this.preview = { x, y };
      if (this.previewLineEl) {
        this.previewLineEl.setAttribute('x2', String(x));
        this.previewLineEl.setAttribute('y2', String(y));
      }
    }
  }

  private onPointerUp(e: PointerEvent, _svg: SVGSVGElement): void {
    const drag = this.drag;
    this.drag = null;

    if (drag?.type === 'wire') {
      const { x, y } = this.toSvg(e.clientX, e.clientY);
      const target = this.segmentAt(x, y);
      if (target && drag.fromId && target.id !== drag.fromId) {
        this.addWire(drag.fromId, target.id);
      } else if (target && drag.fromId && target.id === drag.fromId) {
        // Simple click on segment in wire mode → select & highlight it
        this.wireFrom = null;
        this.preview = null;
        this.selectSegment(target.id, true);
        return;
      } else {
        this.wireFrom = null;
        this.refreshAll();
      }
      this.preview = null;
    }
  }

  // ---- mutations -----------------------------------------------------------

  private addSegment(
    circle: 1 | 2,
    start: number,
    end: number,
    name: string,
    color?: string,
    titleCard?: string,
    note?: string,
  ): Segment | null {
    if (!this.project) return null;
    const chosenColor = color || this.pendingColor || this.nextColor();
    const seg = createSegment(circle, start, end, chosenColor, name);
    if (titleCard) seg.titleCard = titleCard;
    if (note) seg.note = note;
    this.project.segments.push(seg);
    this.selectedId = seg.id;
    this.pending = null;
    this.pendingColor = this.nextColor();
    this.scheduleSave();
    this.refreshAll();
    return seg;
  }

  private nextColor(): string {
    const counts = new Map<string, number>();
    for (const c of PALETTE) counts.set(c, 0);
    for (const s of this.project?.segments ?? []) counts.set(s.color, (counts.get(s.color) ?? 0) + 1);
    let best = PALETTE[0];
    let bestCount = Infinity;
    for (const c of PALETTE) {
      const n = counts.get(c) ?? 0;
      if (n < bestCount) { best = c; bestCount = n; }
    }
    return best;
  }

  private addWire(from: string, to: string): void {
    if (!this.project || from === to) return;
    if (this.project.wires.some((w) => w.from === from && w.to === to)) return;
    this.project.wires.push({ id: randomId(), from, to });
    this.wireFrom = null;
    this.scheduleSave();
    this.refreshAll();
  }

  private deleteWire(id: string): void {
    if (!this.project) return;
    this.project.wires = this.project.wires.filter((w) => w.id !== id);
    this.scheduleSave();
    this.refreshAll();
  }

  private deleteSegment(id: string): void {
    if (!this.project) return;
    this.project.segments = this.project.segments.filter((s) => s.id !== id);
    this.project.wires = this.project.wires.filter((w) => w.from !== id && w.to !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.scheduleSave();
    this.refreshAll();
  }

  // ---- note mapping --------------------------------------------------------

  private linkNote(segId: string): void {
    new NoteLinkModal(this.app, (file) => {
      const seg = this.project?.segments.find((s) => s.id === segId);
      if (seg) {
        seg.noteLink = fileToLink(file);
        this.scheduleSave();
        this.refreshAll();
        void this.openNoteLink(seg.noteLink);
      }
    }).open();
  }

  private linkNoteToMinute(minute: number): void {
    new NoteLinkModal(this.app, (file) => {
      if (!this.project) return;
      const existing = this.project.minuteNotes.find((m) => m.minute === minute);
      const link = fileToLink(file);
      if (existing) existing.noteLink = link;
      else this.project.minuteNotes.push({ minute, noteLink: link });
      this.scheduleSave();
      this.refreshAll();
      void this.openNoteLink(link);
    }).open();
  }

  /** Ensure all parent folders in `folderPath` exist in the Obsidian vault. */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const clean = normalizePath(folderPath.trim());
    if (!clean || clean === '/' || clean === '.') return;
    const parts = clean.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        try {
          await this.app.vault.createFolder(current);
        } catch {
          // Ignore if created concurrently
        }
      }
    }
  }

  /**
   * Create a new Title-Card Note inside the Obsidian vault for `seg`, link it
   * to the segment, and open it in the side panel.
   */
  private async createNoteForSegment(seg: Segment): Promise<void> {
    const rawTitle = (seg.titleCard?.trim() || seg.text?.trim() || `Segment ${segmentRange(seg)}`).trim() || 'Untitled Segment';
    const safeFileName = sanitizeFileName(rawTitle);
    const folder = (this.plugin.settings.noteFolder || '').trim();

    try {
      if (folder) {
        await this.ensureFolderExists(folder);
      }

      const basePath = normalizePath(folder ? `${folder}/${safeFileName}.md` : `${safeFileName}.md`);
      let file: TFile | null = null;
      const existing = this.app.vault.getAbstractFileByPath(basePath);

      if (existing instanceof TFile) {
        file = existing;
      } else {
        const rangeStr = segmentRange(seg);
        const yamlTitle = rawTitle.replace(/"/g, '\\"');
        const yamlSegment = (seg.text || rawTitle).replace(/"/g, '\\"');
        const lines = [
          '---',
          `title: "${yamlTitle}"`,
          `segment: "${yamlSegment}"`,
          `circle: ${seg.circle}`,
          `range: "${rangeStr}"`,
          `color: "${seg.color}"`,
          'story-clock: true',
          '---',
          '',
          `# ${rawTitle}`,
          '',
          `> **Story Clock** · \`${rangeStr}\` · **${seg.text || rawTitle}**`,
          '',
        ];
        if (seg.note?.trim()) {
          lines.push(seg.note.trim(), '');
        }
        file = await this.app.vault.create(basePath, lines.join('\n'));
      }

      if (file) {
        seg.noteLink = { path: file.path, title: file.basename };
        if (!seg.titleCard?.trim()) {
          seg.titleCard = rawTitle;
        }
        this.scheduleSave();
        this.refreshAll();
        await this.openNoteLink(seg.noteLink);
        new Notice(`Title-card note ready: ${file.basename}`);
      }
    } catch (err) {
      new Notice(`Could not create title-card note: ${ err instanceof Error ? err.message : String(err) }`);
    }
  }

  private async openNoteLink(link: NoteLink): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(link.path);
    if (file instanceof TFile) {
      const behavior = this.plugin.settings.openBehavior;
      const leaf = this.app.workspace.getLeaf(behavior === 'side' ? 'split' : behavior === 'tab' ? 'tab' : false);
      await leaf.openFile(file);
    } else {
      new Notice(`Linked note not found in vault: ${link.path}`);
    }
  }
}

function arrowPoints(x1: number, y1: number, x2: number, y2: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 9;
  const a = angle - Math.PI / 6;
  const b = angle + Math.PI / 6;
  return `${x2},${y2} ${x2 - size * Math.cos(a)},${y2 - size * Math.sin(a)} ${x2 - size * Math.cos(b)},${y2 - size * Math.sin(b)}`;
}
