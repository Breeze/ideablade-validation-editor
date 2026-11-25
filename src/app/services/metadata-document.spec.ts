import { describe, expect, it } from 'vitest';

import { MetadataDocument } from './metadata-document';

// A JSON file as the editor reads it, with \n or with Windows line ends (\r\n), which git gives files on Windows.
const lf = '{\n  "Customer": {\n    "properties": {}\n  }\n}\n';
const crlf = lf.replace(/\n/g, '\r\n');
const open = (text: string) => new MetadataDocument({ path: 'C:/x/validation.metadata.json', format: 'json', doc: JSON.parse(text), text });

describe('a JSON metadata file', () => {
  it("isn't changed when it was opened with Windows line ends", () => {
    const doc = open(crlf);
    expect(doc.dirty()).toBe(false);
    // The forms writing back what's there, or the JSON view's text (which has \n line ends): still the same.
    doc.setDoc(JSON.parse(crlf));
    expect(doc.dirty()).toBe(false);
    doc.setJsonText(lf);
    expect(doc.dirty()).toBe(false);
  });

  it('is changed by a real edit, whatever its line ends', () => {
    for (const text of [lf, crlf]) {
      const doc = open(text);
      doc.setDoc({ ...doc.doc(), Order: {} });
      expect(doc.dirty()).toBe(true);
    }
  });

  it('is saved with the line ends it had', () => {
    const windows = open(crlf);
    windows.setDoc({ ...windows.doc(), Order: {} });
    expect(windows.jsonFileText()).toContain('\r\n');
    expect(windows.jsonFileText().replace(/\r\n/g, '')).not.toContain('\n');
    const unix = open(lf);
    unix.setDoc({ ...unix.doc(), Order: {} });
    expect(unix.jsonFileText()).not.toContain('\r');
    // Once saved, it's unchanged again.
    windows.markSaved(windows.jsonFileText());
    expect(windows.dirty()).toBe(false);
  });
});
