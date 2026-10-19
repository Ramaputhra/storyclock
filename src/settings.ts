// Plugin settings.

import { App, PluginSettingTab, Setting } from 'obsidian';
import type StoryClockPlugin from './main';

export const BMC_URL = 'https://buymeacoffee.com/ramaputhra';

export interface StoryClockSettings {
  /** Folder where title-card notes are created ('' = vault root). */
  noteFolder: string;
  /** How linked notes open: 'side' | 'tab' | 'current'. */
  openBehavior: 'side' | 'tab' | 'current';
}

export const DEFAULT_SETTINGS: StoryClockSettings = {
  noteFolder: 'Story Clock',
  openBehavior: 'side',
};

export class StoryClockSettingTab extends PluginSettingTab {
  plugin: StoryClockPlugin;

  constructor(app: App, plugin: StoryClockPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Title-card folder')
      .setDesc('Folder (relative to the vault) where new title-card notes are created.')
      .addText((text) =>
        text
          .setPlaceholder('Story Clock')
          .setValue(this.plugin.settings.noteFolder)
          .onChange(async (value) => {
            this.plugin.settings.noteFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Open linked notes')
      .setDesc('Where a note opens when you click a mapped segment.')
      .addDropdown((dd) =>
        dd
          .addOption('side', 'Side panel (split)')
          .addOption('tab', 'New tab')
          .addOption('current', 'Current pane')
          .setValue(this.plugin.settings.openBehavior)
          .onChange(async (value) => {
            this.plugin.settings.openBehavior = value as StoryClockSettings['openBehavior'];
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('hr');

    new Setting(containerEl)
      .setName('Support Story Clock')
      .setDesc('If Story Clock helps your writing or plotting workflow, consider buying the author a coffee.')
      .addButton((btn) =>
        btn
          .setButtonText('☕ Buy me a coffee')
          .setCta()
          .onClick(() => {
            window.open(BMC_URL, '_blank', 'noopener,noreferrer');
          }),
      );
  }
}
