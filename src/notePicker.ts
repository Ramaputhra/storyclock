// Fuzzy note picker (link an existing note by title).

import { App, FuzzySuggestModal, TFile } from 'obsidian';
import type { NoteLink } from './types';

export function fileToLink(file: TFile): NoteLink {
  return { path: file.path, title: file.basename };
}

export class NoteLinkModal extends FuzzySuggestModal<TFile> {
  private onPick: (file: TFile) => void;

  constructor(app: App, onPick: (file: TFile) => void) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder('Type a note title…');
    this.emptyStateText = 'No notes found';
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file: TFile): string {
    return file.basename;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
