import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { EditorStore } from '../../services/editor-store';
import { THEME_LABELS, type ThemeSetting } from '../../services/theme';

/**
 * The sidebar's Settings section: other validators (registered by the app but in no source file), camelCase server
 * names, and the colour theme. With a project, the first two are the project's (shared with the team); the theme is
 * always this user's own.
 */
@Component({
  selector: 'app-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.css',
})
export class SettingsPanel {
  readonly store = inject(EditorStore);
  readonly themes: ThemeSetting[] = ['dark', 'light', 'system'];
  readonly themeLabels = THEME_LABELS;

  /** The other validators, typed as a comma- or space-separated list. */
  setCustom(text: string): void {
    this.store.updateSettings({ customValidators: text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) });
  }
}
