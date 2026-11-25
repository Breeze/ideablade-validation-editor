# <img src="build/icon.png" alt="" width="40" align="top"> IdeaBlade Validation Editor

A desktop editor for [IdeaBlade Validation](https://github.com/Breeze/ideablade-validation)'s JSON validation metadata (`validation.metadata.json`), so the rules no longer have to be written by hand. It's a first drop: a working prototype, not a finished product.

![Editing a model-level rule](docs/screenshots/model-editor.png)

## What it does

- **Several metadata files, side by side, in JSON, TypeScript or C#.** Open as many as the application has: the server's `validation.metadata.json` and a client's own view model metadata, for example. Each is listed on the left with its model types; the checks, code completion and "Try it" see all of them together, merged as the library merges several metadata maps (`addMetadata`, `AddMetadataJson`). So `ResourceName.firstName`'s `from: 'StaffingResource'` in the client's TS file resolves against the server's JSON, a duplicate error key across files is caught, and a model type in two files gets a note that the library merges them.
  - **JSON files**, as before.
  - **TypeScript:** a `ModelValidationMetadataMap` object literal, as in TempHire's `client-validation-metadata.ts` (`export const x: ModelValidationMetadataMap = { ... }`, or `{ ... } satisfies ModelValidationMetadataMap`). A file with several maps opens as several documents. Saving rewrites only that object literal, in the Prettier style TempHire uses (single quotes, trailing commas, 100 columns), and keeps the file's line endings: the imports, doc comments and other code stay as they are, and an unchanged map is written back byte for byte. A map with code in it (a spread of another map, a reference to a constant) opens read-only, with the reason.
  - **C#:** the .NET library reads metadata as JSON, so in C# it's a JSON string, usually a raw string literal: `public const string Json = """ { ... } """;` passed to `AddMetadataJson`. Verbatim `@"..."` strings work too. Comments and trailing commas in the JSON are read, as .NET allows them. Saving rewrites only the string, keeping its indentation.
  - Comments inside a TS object or C# JSON can't be kept when it's rewritten: the editor says so, and asks before saving. Use `$comment` for notes that should stay.
  - **Save as…** converts: the extension you choose (.json, .ts, .cs) sets the format. A new TS file gets an `import type { ModelValidationMetadataMap }` and an exported constant named after the file; a new C# file a static class with a `Json` constant. **Save all** saves every changed document.
- **Opens, edits and saves** metadata. Model types are listed on the left. For each one you see its `extends`, `condition`, `$comment`, model-level rules (with `id`, `condition` and `propertyNames`) and properties (`from`, `displayName`, `required`, `minLength`, `maxLength`, rules). Groups (`{ "group": ..., "validators": [...] }`) are edited in place. `$schema`, `$comment` and anything the forms don't know about are kept.
- **Forms instead of raw JSON.** Validator names come from a list: the built-in validators and the application's own (see Sources). Each validator shows its description, default message and context settings: for the built-in ones from the library's `docs/validators.md` (`minValue`/`maxValue` for `range`, `other`/`op` for `compare`, `values`, and so on), for the application's from what their code reads. `pattern`'s `flags` are toggles for `i`, `m`, `s` and `u`, each saying what it does in the browser and on the .NET server: the server honours `i`, `m` and `s`, and ignores `u`. Each rule shows the error key it will get (`name[_group]_property`, or `name[_group]_id` for model-level rules).
- **A regular expression panel for `pattern` rules**, with what an online regex tester gives, without leaving the editor:
  - the pattern coloured by its parts (anchors, character classes, groups, repeats, alternatives), with an explanation of each part when you hover it, and the whole pattern explained step by step ("the start of the value, then one of A–Z, a–z, a space, one or more times, then the end of the value");
  - **values to try**: lines that should pass and lines that should fail, each marked ✓ or ✗ as you type, with the matched part underlined. They're tested the way the validator tests them (`test()` from the start of the value; empty values pass). The values are kept with the rule, so they're there to check the pattern again at the next edit: in the project file (`regexTests`), saved when you save the metadata, so the team shares them; without a project file, for you alone. They're keyed like the rule's error key (`PhoneNumber.areaCode`, `Address.city@submit`, `Order#DATES_IN_ORDER` for a model-level rule) and move along when you rename the model, the property or the group, or change a model-level rule's id. TempHire's project files have them for its two `PhoneNumber` patterns;
  - **hints** for the mistakes that matter in a validator: a pattern without `^` and `$` passes when any part of the value matches (with a button that adds them), `m` making `^`/`$` work per line, and what the .NET server, which ignores the `u` flag, does differently: `\p{L}` without `u` is the text `p{L}` in the browser but a Unicode category on the server; `\u{…}` and `\p{Script=…}` make the server throw when it creates the validator (also reported as an error in the checks); with `s` or `\p{…}` the server's `\d` and `\w` accept non-ASCII digits and letters; and an emoji is one character in the browser with `u` but two on the server. Syntax errors point at the exact position;
  - **common patterns** to start from (letters only, a name, a code, no leading or trailing spaces…), with a note where a built-in validator such as `zipCode` or `phone` does the same.

  It's built on [regexpp](https://github.com/eslint-community/regexpp), the regular expression parser ESLint uses.

  ![The regular expression panel: a pattern without ^ and $, the hint that offers to add them, the pattern read step by step, and values to try, two of which pass though they should fail](docs/screenshots/regex-panel.png)
- **Code completion in expressions** (model conditions, rule conditions, the `expression` validator). As you type, or with Ctrl+Space, it offers what the library puts in scope there:
  - the variables: `model`, `value` (rules only), `context`, `isClient`, `isServer`, `store(type)`, and for model conditions `entityInfos` and `findEntity(id, type)`;
  - the model's properties, with their types, and the members of those types: `model.firstName.` offers the string methods, `value.` on a date the `get…` methods, `model.addresses.` the array methods;
  - entities across the store: `store('` offers the model types, `store('Address').some(a => a.` the properties of an address; callback parameters in general get their element type;
  - what `context` always holds (`model`, `modelType`, `propertyName` or `propertyNames`, `displayName`, `messageTemplate`, `isClient`, ...) plus the rule's own settings;
  - the application's expression functions (see Sources), and the globals and methods the safe evaluator allows (`Math`, `Date`, `Number`, `Object`, ...).

  Completion only suggests: properties it doesn't know (values a context provider adds, members of a type no source describes) can still be typed. Syntax errors are underlined where the parser stops.
- **Sources: pick real models, properties, validators and functions.** Add Breeze metadata (Breeze's native JSON, as a Breeze server's `Metadata` endpoint returns it), or TypeScript or C# files with view models, DTOs and form models, and with the application's own validators and expression functions. Their types appear when you add a model, and their properties when you add a property, set `propertyNames`, `compare`'s `other`, `extends` or `from`, and in expressions. Names the sources don't know are flagged as warnings, so typos show up. Rules for models that are in no source (a view model you haven't pointed it at) still work.
  - **Breeze:** entity and complex types, with data and navigation properties. Server names (`nameOnServer`) are camel-cased, as the metadata's property names are (switch this off in Settings).
  - **TypeScript:** interfaces, object type aliases, and classes with their public properties, getters and constructor parameter properties. Angular components, services, directives and pipes are skipped, and so are validator classes. Read with the TypeScript compiler API.
  - **The application's validators, TS:** `syncValidator('name', …, 'message')`, `asyncValidator(…)`, `{ name: 'x', fn: … }` factories, and classes extending `SyncValidator` / `AsyncValidator` (`super('name', …)`, `withMessage(context, '…')`). Their settings are the context values their code reads: `ctx.factor`, `ctx['factor']`, `const { factor } = ctx`, `(value, { factor }) => …`.
  - **The application's validators, C#:** classes deriving from `Validator`, `SyncValidator` or `AsyncValidator` (`base("name", …)`, `WithMessage(context, "…")`), and `new ValidatorFactory("name", …)`. Settings come from `GetValue<T>("x")` (typed: a number becomes a number field, `bool` a checkbox), `GetValues<T>("x")` (a list) and `context["x"]`.
  - **Expression functions:** `expressionScope: { … }` and `provideExpressionScope(…)` (TS), `AddExpressionFunction("name", (Func<…>)(…))` (C#), with their parameters and return types where the code says.
  - The checks know these validators: no "unknown validator" for them, and an error when a rule's `async` doesn't match how the validator is registered. Validators that are in no source file can be listed under Settings → Other validators.
  - **C#:** classes, records (including positional parameters) and structs with their public instance properties, base classes and `[StringLength]`/`[MaxLength]` hints. This is a lightweight reader rather than a compiler, enough for DTOs and view models.
  - **Kept up to date:** each source file is watched and read again when it changes (also **Reload sources**, F5).
- **A project file to share with the team:** an IdeaBlade Validation Project, `*.ivproj` (JSON), next to the metadata or in a folder above it, lists the metadata files to open together, the sources and the shared settings (other validators, camelCase). Paths are relative to it, and sources can be patterns, such as a folder of DTOs. TempHire's, `temphire.ivproj` at the root of temphire.angular, takes the entities from the Breeze metadata that `npm run model` exports (and generates the entity classes from), plus the view models that aren't in it:

  ```json
  {
    "metadata": [
      "server/TempHire.Server/Validation/validation.metadata.json",
      "client/src/app/core/validation/client-validation-metadata.ts"
    ],
    "sources": [
      "client/metadata.json",
      "client/src/app/core/projections/*.ts",
      "client/src/app/resource-mgt/resource-name-editor.component.ts"
    ],
    "otherValidators": [],
    "camelCase": true
  }
  ```

  Opening the project file (Open…, **File → Open Recent Project**, or on the command line) opens its metadata files and loads its sources. Another project replaces what's open, after asking about unsaved changes; the one that's open already stays as it is. The recent list has the last 10 projects, the latest first (Alt+F, R, 1 opens the latest), leaves out the ones that have been moved or deleted, and can be cleared; Windows shows them in the taskbar's jump list too. Opening one of its metadata files finds the project (the `*.ivproj` in that folder, or in the nearest folder above that has one; with several, the first by name) and uses its sources and settings. **Create project file…** in the sidebar writes one from what's open, named after its folder by default. The installer registers `.ivproj`, so double-clicking a project opens it in the editor. The content is JSON: to have VS Code colour it as such, map it in `files.associations` (`"*.ivproj": "json"`). Changes (added sources, newly opened files, settings) show as unsaved until you save the project, with Save all or its own Save; closing a file doesn't take it out of the project. **New files are picked up:** the folders a pattern points at are watched, so a new DTO appears as a source as soon as its file is written, and a deleted one goes; Reload sources (F5) expands the patterns again too. A pattern stays as it is when the project is saved, as long as it still matches a loaded file. The project file is watched too (see below). Keys the editor doesn't know, such as `$comment`, are kept. Without a project file, the editor remembers the sources per metadata file for you alone (in its app data).
- **Checks as you edit** (Issues tab, and next to each field):
  - **Schema:** against `validation-metadata.schema.json` from the installed `ideablade-validation` package.
  - **The library:** `ideablade-validation` itself checks what the schema can't. It reports unknown validator names, `async` that doesn't match an app validator's registration, regular expression flags that are invalid, have no effect (`g`) or behave differently on client and server (`y`, `v`), expressions and conditions that don't parse (`checkExpression`), invalid `pattern`s, and `from`/`extends` that lead nowhere. It also runs the duplicate error key check (`ModelMetadata.checkErrorKeys`), which the service runs before it first validates a model type. Rule sources work as in the app: a `from` that names a Breeze entity resolves, as it does with `breezeRuleSource`.
  - **Sources:** properties, `propertyNames` and `compare`'s `other` that the model doesn't have.
- **JSON view** next to the forms, kept in step both ways. It's a code editor, as in VS Code: Enter indents the new line to the level of the one before it, and Enter after `{` or `[` puts the cursor one level in with the closing bracket on its own line below. It also adds closing brackets and quotes, shows the matching bracket, folds objects and arrays, has line numbers and VS Code's JSON colours, and searches with Ctrl+F. Tab and Shift+Tab indent and outdent; press Esc first to move focus on with Tab instead. A syntax error is underlined where the parser stops. JSON that doesn't parse isn't applied; the forms keep the last valid state until it parses again. Undo there undoes your typing, not edits made in the forms.
- **Try it:** validate a sample object against the metadata as it is now, with the library's real service. You can give it a store (entities by type) for `store('Type')` expressions. Validators the editor doesn't have (`breeze`, custom ones) pass, and async validators don't run.
- **Files changed outside the editor:** the open metadata files and the project file are watched too, but unlike sources they aren't reloaded on their own, since you may be in the middle of editing them. When one changes on disk (in another editor, another session, a `git pull`), a dialog names the changed files, says which have unsaved changes that reloading would discard, and asks whether to **Reload** or **Keep the editor's version**. A file deleted on disk only gets a note in the status bar; saving writes it again. Saving checks first: if the file on disk is no longer what the editor read or last saved, it warns that saving would overwrite those changes and offers **Overwrite**, **Reload from disk** or **Cancel**. This holds for every save, metadata and project file alike, including the `regexTests` the editor writes to the project. The editor's own saves don't count as outside changes.
- **Dark theme** by default, with VS Code's Dark+ colours, also for the code in expressions. Settings → Theme switches to Light, or to Follow Windows; the window frame, menus and dialogs follow.
- **The editor opens where you left it:** the project you used last (opened, found next to a metadata file, or created), when it's started without files on its command line, as from the Start menu; the window's size, position and maximised state; and what was selected in the sidebar (a model, or a file's settings) for each project, or for the first metadata file without one. These are your settings, so they're kept in the app's data folder (`window-state.json`), not in the project file. A position that's no longer on a screen, after unplugging a monitor, is replaced by a centred window of the same size. A project that has been moved or deleted since isn't reopened: the editor starts with a new document. With nothing remembered, the first model in the list is selected.

| Several files: JSON and TS side by side | Code completion in an expression | The application's own validators |
|---|---|---|
| ![](docs/screenshots/several-files.png) | ![](docs/screenshots/completion.png) | ![](docs/screenshots/app-validators.png) |

| Rules for a view model from a TS file | The duplicate error key check | Try it |
|---|---|---|
| ![](docs/screenshots/view-model.png) | ![](docs/screenshots/duplicate-key.png) | ![](docs/screenshots/try-it.png) |

| TempHire's project file, with its pattern's values to try | The JSON view: folding, search, VS Code's colours | A file changed outside the editor |
|---|---|---|
| ![](docs/screenshots/project.png) | ![](docs/screenshots/json-editor.png) | ![](docs/screenshots/outside-change.png) |

## Running it

Node 26.13.1 (the current LTS; `.node-version`) to build and run the tooling. With nvs: `nvs use 26.13.1`. The app itself runs on the Node inside Electron (24.22 in Electron 45).

```powershell
npm install
npm start
```

`npm start` builds the Angular app into `dist/` and starts Electron on it. The first start downloads the Electron binary.

While working on the editor, `npm run dev` runs `ng serve` (port 4300) with live reload and Electron pointed at it.

A project file, metadata files (JSON, TS or C#) and sources can be given on the command line; without any, the editor reopens the project used last. TempHire's Angular client has a project file at its root:

```powershell
npm run build
npx electron . ../temphire.angular/temphire.ivproj
```

Or files and sources one by one:

```powershell
npx electron . samples/temphire.validation.metadata.json --source=samples/temphire.breeze-metadata.json --source=samples/app-validation.ts
```

The `samples/` folder has TempHire's validation metadata and its Breeze metadata, exported from `TempHirePersistenceManager.Metadata()`, and `app-validation.ts`, an example of an application's own validators and expression functions as the editor reads them.

### Tests

```powershell
npm test
```

Unit tests (Vitest, through Angular's test builder) cover the Breeze and C# readers, metadata in C#, the checks on TempHire's metadata, completion, and the tester. The main process's code (metadata in TypeScript, the project file) is tested with Node's test runner on **Electron's own Node** (24.22 in Electron 45), because that's what it runs on in the app, whatever `.node-version` says: `.node-version` only picks the Node that builds the app and runs the tooling.

## Packaging

```powershell
npm run dist
```

This builds a Windows installer with electron-builder: `release/IdeaBlade Validation Editor Setup 0.1.0.exe`. It's an NSIS installer that asks who the app is for: "Anyone who uses this computer" (the default: `C:\Program Files`, with an administrator prompt) or "Only me" (`%LOCALAPPDATA%\Programs`, no prompt). The folder can be changed. Installing again over an existing installation keeps its choice. `npm run dist:dir` builds only the unpacked app (`release/win-unpacked/`), which is quicker for checking the packaged build. The installer isn't code-signed.

The icon (JSON braces around a check: validation metadata whose rules pass) is drawn in `build/icon.svg`, with a bolder `build/icon-small.svg` for 16–24 px, where the thin lines blur. `npm run icon` renders both with Electron into `build/icon.ico` (16–256 px), used for the window, the exe, the installer and `.ivproj` files, and `build/icon.png` (512 px). Run it after changing either SVG, and commit the results.

npm 11 lists some packages whose install scripts it didn't run (`esbuild`, `lmdb`, `@parcel/watcher`, `electron-winstaller`, `msgpackr-extract`). The build doesn't need them: esbuild and the watchers come as prebuilt optional packages, and electron-winstaller is only for Squirrel installers.

## How it's built, and why

- **Electron**, for a desktop app that opens and saves files and watches the model sources. The main process (`electron/main.cjs`) owns the file system: dialogs, reading, saving, `fs.watch`, and reading TypeScript files, since the TypeScript compiler needs Node. The renderer is sandboxed with context isolation and gets a small API through `electron/preload.cjs`.
- **Angular 22** (standalone components, signals, zoneless) for the UI. All state is in one signal store (`src/app/editor-store.ts`): the document is the parsed JSON itself, and every edit replaces it immutably. The JSON text, the issues and the model catalog are `computed`s of it, so the forms, the JSON view and the checks can't get out of step.
- **The library itself** (`ideablade-validation` from npm) does the checks the schema can't do and runs the tester. The editor uses the same code the apps run, so it agrees with them.
- **Ajv** checks the schema. The validator is precompiled at build time (`scripts/build-schema-validator.mjs`, into `src/generated/`), so the app's Content-Security-Policy needs no `unsafe-eval`.
- The editor's own logic is plain TypeScript in `src/lib/` and doesn't depend on Angular: the document helpers, the validator catalog, the source readers, metadata in C#, expression completion, the checks and the tester. Metadata in TypeScript is read and written in `electron/typescript-metadata.cjs`, in the main process, with the TypeScript compiler. Expression fields, the pattern field and the JSON view use CodeMirror 6.

## Limitations of this first drop

- Saving a JSON file after a form edit writes the whole file in standard two-space JSON. Hand formatting is lost, such as TempHire's one-line `"global": { "validators": ["breeze"] }`. Edits in the JSON view are saved as typed. TS objects and C# strings are rewritten in a fixed style (Prettier's for TS), so hand formatting inside them is lost too, and so are comments inside them.
- Metadata built in code (TS maps put together with spreads or functions, C# built from `ModelValidationConfig` objects) can't be edited: TS maps with code open read-only, and C# is read only as JSON strings.
- The documents are listed one above the other in one window; there is no split view showing two model editors at once.
- Breeze metadata comes from a file. TempHire's `api/model/Metadata` endpoint needs a signed-in user, so save its response, or export it as `samples/` was.
- Model sources supply names, not rules: `from` a Breeze entity resolves, but in "Try it" the inherited Breeze rules (`[Required]`, `[StringLength]`) don't run.
- C# is read with patterns, not Roslyn. Unusual syntax (properties split over several lines, generics with nested angle brackets in property types) may be missed.
- A validator's settings are found only where its own code reads them (`ctx.x`, `GetValue<T>("x")`). Settings read through a helper method, or a validator class defined in a file that isn't a source, are not.
- Completion follows the types it can see: model properties, `store('Type')`, array callbacks. A value whose type no source describes (`context.someProviderValue.`, an app function returning an untyped object) gets no member suggestions.
- In "Try it", the application's validators always pass: the editor can't run their code.
- No undo beyond the JSON view's own; no drag and drop to reorder rules (use ↑/↓).
