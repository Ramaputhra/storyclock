// Project persistence inside the vault, under
// .obsidian/plugins/story-clock/projects/<id>.json

import { App, normalizePath } from 'obsidian';
import type { Project, ProjectMeta } from './types';
import { createProject, randomId } from './types';

const BASE = '.obsidian/plugins/story-clock/projects';

async function ensureDir(app: App): Promise<void> {
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(BASE))) {
    await adapter.mkdir(BASE);
  }
}

function pathOf(id: string): string {
  return normalizePath(`${BASE}/${id}.json`);
}

export async function listProjects(app: App): Promise<ProjectMeta[]> {
  await ensureDir(app);
  const adapter = app.vault.adapter;
  let files: string[] = [];
  try {
    const listing = await adapter.list(BASE);
    files = listing.files;
  } catch {
    return [];
  }
  const out: ProjectMeta[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(BASE.length + 1, -5);
    try {
      const raw = await adapter.read(f);
      const p = JSON.parse(raw) as Project;
      out.push({
        id,
        name: p.name ?? 'Untitled',
        updatedAt: p.updatedAt ?? '',
        segmentCount: p.segments?.length ?? 0,
        wireCount: p.wires?.length ?? 0,
      });
    } catch {
      // ignore malformed files
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export async function loadProject(app: App, id: string): Promise<Project | null> {
  const adapter = app.vault.adapter;
  const p = pathOf(id);
  if (!(await adapter.exists(p))) return null;
  try {
    const raw = await adapter.read(p);
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export async function saveProject(app: App, project: Project): Promise<void> {
  await ensureDir(app);
  project.updatedAt = new Date().toISOString();
  await app.vault.adapter.write(pathOf(project.id), JSON.stringify(project, null, 2));
}

export async function createProjectFile(app: App, name: string): Promise<Project> {
  const project = createProject(name);
  await saveProject(app, project);
  return project;
}

export async function duplicateProjectFile(app: App, id: string): Promise<Project | null> {
  const src = await loadProject(app, id);
  if (!src) return null;
  const clone: Project = {
    ...JSON.parse(JSON.stringify(src)),
    id: randomId(),
    name: `${src.name} (copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveProject(app, clone);
  return clone;
}

export async function deleteProjectFile(app: App, id: string): Promise<void> {
  const adapter = app.vault.adapter;
  const p = pathOf(id);
  if (await adapter.exists(p)) {
    await adapter.remove(p);
  }
}
