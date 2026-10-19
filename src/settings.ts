// Plugin settings using Obsidian 1.13+ declarative settings API.

import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type StoryClockPlugin from './main';

export const BMC_URL = 'https://buymeacoffee.com/ramaputhra';

export interface StoryClockSettings {
  /** Folder where title-card notes are created ('' = vault root). */
  noteFolder: string;
  /** How linked notes open: 'side' | 'tab' | 'current'. */
  openBehavior: 'side' | 'tab' | 'current';
}

export const DEFAULT_SETTINGS: StoryClockSettings = {
  noteFolder: 'Story Circle',
  openBehavior: 'side',
};

export class StoryClockSettingTab extends PluginSettingTab {
  plugin: StoryClockPlugin;

  constructor(app: App, plugin: StoryClockPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    if (key === 'noteFolder') return this.plugin.settings.noteFolder;
    if (key === 'openBehavior') return this.plugin.settings.openBehavior;
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === 'noteFolder' && typeof value === 'string') {
      this.plugin.settings.noteFolder = value.trim();
      await this.plugin.saveSettings();
    } else if (
      key === 'openBehavior' &&
      (value === 'side' || value === 'tab' || value === 'current')
    ) {
      this.plugin.settings.openBehavior = value;
      await this.plugin.saveSettings();
    }
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Title-card folder',
        desc: 'Folder (relative to the vault) where new title-card notes are created.',
        control: {
          type: 'text',
          key: 'noteFolder',
          placeholder: 'Story Circle',
          defaultValue: DEFAULT_SETTINGS.noteFolder,
        },
      },
      {
        name: 'Open linked notes',
        desc: 'Where a note opens when you click a mapped segment.',
        control: {
          type: 'dropdown',
          key: 'openBehavior',
          defaultValue: DEFAULT_SETTINGS.openBehavior,
          options: {
            side: 'Side panel (split)',
            tab: 'New tab',
            current: 'Current pane',
          },
        },
      },
      {
        name: 'Support Story Circle',
        desc: 'If Story Circle helps your writing or plotting workflow, consider buying the author a coffee.',
        render: (setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText('Buy me a coffee')
              .setCta()
              .onClick(() => {
                window.open(BMC_URL, '_blank', 'noopener,noreferrer');
              }),
          );
        },
      },
    ];
  }
}
