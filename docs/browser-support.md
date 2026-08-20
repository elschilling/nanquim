# Browser and file API support

Last reviewed: 2026-08-20

This document defines the intended `v0.1` desktop-browser support contract. It
does not claim that a browser has passed release qualification unless the exact
browser and operating-system versions are recorded in that release's notes.

## Browser tiers and version policy

| Tier | Browser versions | Release expectation |
| --- | --- | --- |
| Primary | Current stable desktop Chromium and the immediately preceding stable major at release time | Core CAD workflows and both standard and direct-file workflows are release gates. |
| Supported fallback | Current stable desktop Firefox and the current Firefox ESR at release time | Core CAD workflows and upload/download file fallbacks are release gates. |
| Best effort | Current stable desktop Safari on macOS at release time | Perform a manual prerelease check when a test machine is available. A Safari-only failure is documented but is not yet a beta release gate. |
| Not supported | Mobile browsers, touch-only devices, embedded webviews, and browsers older than the versions above | The interface and pointer workflow are not qualified for these environments. |

The project tracks release channels instead of permanently embedding evergreen
browser version numbers here. Each candidate's release notes must record the
exact browser build, operating system, test date, and result. An installed
browser is not considered verified merely because the project builds or its
version was queried.

## Capability matrix

“Feature detected” means that Nanquim uses an API only when the relevant entry
point exists. “Fallback” means a different workflow with different persistence
semantics, not a polyfill for direct disk access.

| Capability | Desktop Chromium | Desktop Firefox | Desktop Safari |
| --- | --- | --- | --- |
| Model/Paper editor, terminal, Help, SVG rendering | Primary target; real-browser qualification required | Supported target; real-browser qualification required | Best effort; manual qualification only |
| Open SVG/DXF | `showOpenFilePicker()` when available; otherwise file-input fallback | File-input fallback | File-input fallback |
| Save editable SVG | `showSaveFilePicker()` when available; otherwise download fallback | Download fallback | Download fallback |
| Direct `Ctrl+S` overwrite | Available only for a writable retained file handle | Not available | Not available |
| Recent disk-file handles | Available when a picker returns a serializable handle; permission may need to be granted again | Not available | Not available |
| SVG, DXF, and Paper SVG download | Blob URL plus an anchor `download` action | Same fallback target | Same fallback target |
| Paper PDF export | Implemented, but requires release-candidate rendering checks | Implemented, not yet qualified | Best effort, not yet qualified |
| Copy selected Nanquim geometry | Partial: Async Clipboard requires HTTPS/localhost; permission, site policy, and transient-activation behavior can vary by Chromium version | Partial: Async Clipboard requires HTTPS/localhost and engine-specific activation/prompt behavior | Partial: Async Clipboard requires HTTPS and engine-specific activation/prompt behavior |
| Paste Nanquim geometry | Native paste-event path first, then permitted Async Clipboard read | Same intended path | Same intended path |
| Preferences | `localStorage`, when storage is available | Same | Same |
| Recent-handle metadata | IndexedDB plus File System handles | IndexedDB exists, but Nanquim cannot create picker handles | IndexedDB exists, but Nanquim cannot create picker handles |

### Direct files versus fallbacks

The direct File System Access workflow requires all of the following:

- a secure context (`https` or `localhost`);
- a desktop browser that exposes `showOpenFilePicker()` and
  `showSaveFilePicker()`;
- a user gesture for the picker or permission request; and
- read/write permission for an existing handle before it can be overwritten.

Nanquim stores recent handles in IndexedDB, not file contents. A recent entry
does not guarantee future access: permissions can expire, and a moved or
deleted file invalidates the handle.

The portable open fallback uses `<input type="file">` and `FileReader`. It does
not retain a disk handle. The portable save fallback downloads a new file via a
Blob URL; it cannot overwrite the original file in place.

### Clipboard limitations

System clipboard access is permission- and activation-sensitive even in
otherwise supported browsers. Paste has a native `paste` event path, but copy
currently has no non-Clipboard-API fallback. Until feature detection and
real-browser tests cover denied and unavailable clipboard access, copy/paste is
classified as partial rather than stable.

## Release qualification record

For each beta candidate, record results in the corresponding file under
`docs/releases/`. At minimum, exercise:

1. Open, edit, Undo/Redo, save, and reopen a native SVG.
2. Open SVG and DXF through the standard file-input path.
3. Download native SVG, DXF, Paper SVG, and Paper PDF output.
4. In Chromium, create a file handle, overwrite it with `Ctrl+S`, reload, grant
   permission again if requested, and open it from Recent Files.
5. Copy and paste selected geometry, including the denied-permission behavior.
6. Run Help and the main Model/Paper workflows at normal and narrow desktop
   widths.

## API references

- [MDN: `showOpenFilePicker()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
- [MDN: `showSaveFilePicker()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)
- [Chrome Developers: File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [MDN: Clipboard API security and browser differences](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
- [MDN: IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
