import { Plugin } from 'obsidian';
import { StoryClockView, VIEW_TYPE } from './view';
import { DEFAULT_SETTINGS, StoryClockSettingTab } from './settings';
import type { StoryClockSettings } from './settings';

export default class StoryClockPlugin extends Plugin {
  settings: StoryClockSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new StoryClockView(leaf, this));

    this.addRibbonIcon('timer', 'Open Story Clock', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-story-clock',
      name: 'Open Story Clock',
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new StoryClockSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}
