import { ChangeDetectionStrategy, Component } from '@angular/core';

import { MetadataList } from '../metadata-list/metadata-list';
import { MetadataSearch } from '../metadata-search/metadata-search';
import { ProjectPanel } from '../project-panel/project-panel';
import { SettingsPanel } from '../settings-panel/settings-panel';
import { SourcesList } from '../sources-list/sources-list';

/**
 * The sidebar, on the left: three parts stacked, so a long list of model types scrolls without taking the rest along.
 * - pinned at the top: the project (ProjectPanel), and the Metadata heading with the search (MetadataSearch);
 * - in the middle, scrolling: the metadata files, their maps and model types (MetadataList);
 * - pinned at the bottom (scrolling on its own beyond 45% of the height): the sources (SourcesList) and the settings
 *   (SettingsPanel).
 *
 * It's an attribute component on the `<nav>` element, which is a column of the shell's grid (see App).
 */
@Component({
  selector: 'nav[app-sidebar]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProjectPanel, MetadataSearch, MetadataList, SourcesList, SettingsPanel],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  host: { class: 'sidebar' },
})
export class Sidebar {}
