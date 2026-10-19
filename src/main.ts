import { Plugin } from 'obsidian';
import { StoryClockView, VIEW_TYPE } from './view';
import { DEFAULT_SETTINGS, StoryClockSettingTab } from './settings';
import type { StoryClockSettings } from './settings';

export default class StoryClockPlugin extends Plugin {
  settings: StoryClockSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new StoryClockView(leaf, this));

    this.addRibbonIcon('timer', 'Open circle map', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-circle-map',
      name: 'Open circle map',
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new StoryClockSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Partial<StoryClockSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
