// IPC: the project file (*.ivproj, project/project-file.ts). The renderer works with absolute paths. A project read or
// written becomes the recent one (projectUsed), which File → Open Recent Project and the next start follow. Whether a
// project is open at all is menu state (project:open-state, in window/menu.ts).
import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { findProject, PROJECT_EXTENSION, projectFileName, readProject, writeProject } from '../project/project-file';
import { clearLastProject, getRecentProjects, setLastProject } from '../settings/recent-projects';
import { settingsFilePath } from '../settings/settings-file';
import type { ProjectToWrite } from '../types';
import { mainWindow } from '../window/main-window';
import { updateMenu } from '../window/menu';

/**
 * A project read or written (opened, found next to a metadata file, created) becomes the one to reopen next time and
 * the first in File → Open Recent Project (and in the taskbar's jump list). The menu is rebuilt only when the first
 * recent project changes.
 */
function projectUsed(usedPath: string): void {
  const projectPath = path.resolve(usedPath); // one way of writing each path (backslashes), so none is listed twice
  const before = getRecentProjects(settingsFilePath())[0];
  setLastProject(settingsFilePath(), projectPath);
  app.addRecentDocument(projectPath);
  if (before?.toLowerCase() !== projectPath.toLowerCase()) updateMenu();
}

/** Registers the `project:*` handlers (but project:open-state, which the menu follows). */
export function registerProjectHandlers(): void {
  /** The project a metadata file belongs to: the nearest *.ivproj in its folder or above. */
  ipcMain.handle('project:find', (_e, filePath: string) => findProject(filePath));

  /** The user closed the project: the next start opens nothing (it stays in the recent list). */
  ipcMain.on('project:closed', () => clearLastProject(settingsFilePath()));

  /** Reads a project with absolute paths and its patterns expanded, and makes it the recent one. */
  ipcMain.handle('project:read', async (_e, projectPath: string) => {
    const project = await readProject(projectPath);
    projectUsed(projectPath);
    return project;
  });

  /**
   * Writes a project (keeping keys the editor doesn't manage), returns it as read back, and makes it the recent one.
   */
  ipcMain.handle('project:write', async (_e, projectPath: string, project: ProjectToWrite) => {
    const result = await writeProject(projectPath, project);
    projectUsed(projectPath);
    return result;
  });

  /** Asks where to create a project file, in `defaultDir` (else Documents); the path always ends in .ivproj. */
  ipcMain.handle('project:choose-path', async (_e, defaultDir: string | undefined) => {
    const result = await dialog.showSaveDialog(mainWindow(), {
      title: 'Create a project file',
      // Named after its folder by default: temphire.angular -> temphire.angular.ivproj.
      defaultPath: path.join(defaultDir ?? app.getPath('documents'), projectFileName(path.basename(defaultDir ?? 'validation'))),
      filters: [{ name: 'IdeaBlade Validation Project', extensions: [PROJECT_EXTENSION.slice(1)] }],
    });
    if (result.canceled || !result.filePath) return undefined;
    // The editor finds projects by their extension, so a project file always has it, whatever name was typed.
    return path.join(path.dirname(result.filePath), projectFileName(path.basename(result.filePath)));
  });
}
