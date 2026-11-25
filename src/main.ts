import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyTheme, storedTheme } from './app/services/theme';

// The theme first, so the window doesn't show the other one while the app starts.
applyTheme(storedTheme());

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
