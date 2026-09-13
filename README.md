# Keystroke Capture (Research)

A VS Code extension that records **in-editor** keystroke and edit events with
high-resolution timing, for typing-behavior / keystroke-dynamics research.

## Scope & limits (read this first)

VS Code extensions are **sandboxed to the editor**. This extension can only see
input that happens **inside VS Code windows where it is installed**. It does
**not** and **cannot**:

- capture keystrokes from other applications, the browser, or the OS,
- run as a system-wide keylogger,
- read anything you type outside the editor (terminal excluded, passwords in
  other apps, etc.).

All captured data is written to **local files only**. The extension makes **no
network requests** and sends nothing anywhere.

## What it captures

| Event | Source | Contains |
|-------|--------|----------|
| `keystroke` | `type` command interception | one character-producing keypress, timing, caret line/col |
| `change` | `onDidChangeTextDocument` | insertions/deletions/paste/autocomplete, offsets, lengths |
| `selection` | `onDidChangeTextEditorSelection` (opt-in) | caret/selection movement |
| `focus` | active editor change | which file became active |
| `session_start` | on session begin | environment metadata, capture policy |

Each event carries `t` (wall-clock ms) and `dt` (monotonic ms since session
start, sub-ms precision) for reliable inter-key timing.

## Capture policy (privacy control)

Set `keystrokeCapture.capturePolicy`:

- **`full`** (default) — records the literal characters typed.
- **`categoryOnly`** — records only a category per character (letter / digit /
  whitespace / newline / punct / control). No readable content is stored.
- **`hashed`** — records a short per-session salted hash of each character.
  Preserves repetition and n-gram structure for analysis without storing
  readable text.

Use `categoryOnly` or `hashed` when your study only needs **timing**, or when
recording other people's typing.

## Install & run (development mode)

This extension is **plain JavaScript with no build step** — no `npm install` or
compile needed. Open this folder in VS Code and press **F5** (or Run → "Run
Extension"). A second VS Code window (the Extension Development Host) opens with
the extension loaded.

> The `@types/*` entries in `package.json` are optional dev-time type hints for
> editing `extension.js`. They are not required to run the extension.

To package a `.vsix` for installing normally:

```bash
npm install -g @vscode/vsce
vsce package
```

Then in VS Code: Extensions panel → `...` → "Install from VSIX...".

## Usage

- Click the status bar item (`Keystrokes: off` / `REC`) to toggle recording.
- Command Palette (`Ctrl+Shift+P`):
  - **Keystroke Capture: Start / Stop Recording**
  - **Keystroke Capture: Start New Session** — closes the current file, opens a new one
  - **Keystroke Capture: Open Data Folder**
  - **Keystroke Capture: Show Session Stats**

Recording is **off by default**. Set `keystrokeCapture.autoStart: true` to start
on launch.

## Where data goes

Default: the extension's global storage folder, under `sessions/`. Use
**Open Data Folder** to reveal it, or set `keystrokeCapture.storagePath` to an
absolute path. Each session is one newline-delimited JSON (`.jsonl`) file:
`session_<timestamp>.jsonl`.

## Settings

| Setting | Default | Meaning |
|---------|---------|---------|
| `keystrokeCapture.autoStart` | `false` | Start recording on launch |
| `keystrokeCapture.storagePath` | `""` | Custom output folder (absolute) |
| `keystrokeCapture.capturePolicy` | `"full"` | `full` / `categoryOnly` / `hashed` |
| `keystrokeCapture.captureDocumentChanges` | `true` | Record edit events |
| `keystrokeCapture.captureSelectionChanges` | `false` | Record caret/selection moves |
| `keystrokeCapture.excludeFilePattern` | `""` | Skip files whose path contains this substring |
| `keystrokeCapture.flushIntervalMs` | `2000` | Disk write interval |

## Analyzing a session

```bash
node tools/analyze.js "<data-folder>/session_<timestamp>.jsonl"
```

Prints event counts, inter-key interval stats (mean/median/p95), pause counts,
net characters, and an approximate typing speed. Works under any capture policy
(it uses timing only).

## Research ethics

If you record anyone other than yourself, obtain informed consent, prefer
`categoryOnly`/`hashed` unless raw content is essential, use
`excludeFilePattern` to skip sensitive files, and store/handle the data per your
institution's IRB / data-protection requirements. The status bar always shows
when recording is active.

## License

MIT
