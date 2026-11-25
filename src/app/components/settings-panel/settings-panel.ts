import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { THEME_LABELS, type ThemeSetting } from '../../services/theme';
import { Updates } from '../../services/updates';

/**
 * The sidebar's Settings section: other validators (registered by the app but in no source file), camelCase server
 * names, the colour theme, and updates: whether to check automatically, and whether pre-releases count. With a
 * project, the first two are the project's (shared with the team); the theme and the update settings are always this
 * user's own (the update settings are kept by the main process, which checks).
 */
@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.css',
})
export class SettingsPanel {
  readonly store = inject(EditorStore);
  readonly updates = inject(Updates);
  readonly themes: ThemeSetting[] = ['dark', 'light', 'system'];
  readonly themeLabels = THEME_LABELS;

  /** The other validators, typed as a comma- or space-separated list. */
  setCustom(text: string): void {
    this.store.updateSettings({ customValidators: text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) });
  }
}
