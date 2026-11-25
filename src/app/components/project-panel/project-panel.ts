import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { fileName } from '../../../lib/sources';
import { EditorStore } from '../../services/editor-store';

/**
 * The sidebar's Project section: the open project file (*.ivproj) with its own Save and what it holds, or, without
 * one, a button to create it from what's open. The project shares the metadata files, sources and settings with the
 * team; the store reads and writes it (EditorStore.saveProject).
 */
@Component({
  selector: 'app-project-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-panel.html',
  styleUrl: './project-panel.css',
})
export class ProjectPanel {
  readonly store = inject(EditorStore);
  readonly fileName = fileName;
}
