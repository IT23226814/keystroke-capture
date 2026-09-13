// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Keystroke Capture (Research)
 *
 * Records in-editor keystroke and edit events with high-resolution timing.
 * Scope note: VS Code extensions are sandboxed to the editor. This captures
 * typing and edits *inside VS Code only* — never system-wide input, other
 * applications, or the OS. All data is written to local files; nothing is sent
 * over the network.
 *
 * Plain JavaScript, no build step: `main` points here directly.
 */

/** @type {Recorder | undefined} */
let recorder;
/** @type {vscode.StatusBarItem} */
let statusBar;

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  recorder = new Recorder(context);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'keystrokeCapture.toggle';
  context.subscriptions.push(statusBar);
  updateStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand('keystrokeCapture.toggle', () => {
      if (recorder.isRecording) {
        recorder.stop();
      } else {
        recorder.start();
      }
      updateStatusBar();
    }),
    vscode.commands.registerCommand('keystrokeCapture.start', () => {
      recorder.start();
      updateStatusBar();
    }),
    vscode.commands.registerCommand('keystrokeCapture.stop', () => {
      recorder.stop();
      updateStatusBar();
    }),
    vscode.commands.registerCommand('keystrokeCapture.newSession', () => {
      recorder.newSession();
      updateStatusBar();
    }),
    vscode.commands.registerCommand('keystrokeCapture.openDataFolder', async () => {
      const dir = recorder.getStorageDir();
      await vscode.env.openExternal(vscode.Uri.file(dir));
    }),
    vscode.commands.registerCommand('keystrokeCapture.showStats', () => {
      recorder.showStats();
    })
  );

  context.subscriptions.push({ dispose: () => recorder && recorder.dispose() });

  const cfg = vscode.workspace.getConfiguration('keystrokeCapture');
  if (cfg.get('autoStart', false)) {
    recorder.start();
    updateStatusBar();
  }
}

function deactivate() {
  if (recorder) {
    recorder.dispose();
  }
}

function updateStatusBar() {
  if (!recorder) {
    return;
  }
  if (recorder.isRecording) {
    statusBar.text = '$(record) Keystrokes: REC';
    statusBar.tooltip = `Recording keystrokes to:\n${recorder.getCurrentFilePath()}\nClick to stop.`;
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBar.text = '$(circle-slash) Keystrokes: off';
    statusBar.tooltip = 'Keystroke capture is off. Click to start recording.';
    statusBar.backgroundColor = undefined;
  }
  statusBar.show();
}

class Recorder {
  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.isRecording = false;
    this.context = context;
    /** @type {vscode.Disposable[]} */
    this.disposables = [];
    /** @type {vscode.Disposable | undefined} */
    this.typeCommandDisposable = undefined;

    this.sessionId = '';
    this.sessionStartWall = 0;
    this.sessionStartHr = 0n;
    this.salt = '';

    /** @type {string[]} */
    this.buffer = [];
    /** @type {NodeJS.Timeout | undefined} */
    this.flushTimer = undefined;
    this.currentFilePath = '';

    this.counts = { keystroke: 0, change: 0, selection: 0 };
  }

  start() {
    if (this.isRecording) {
      return;
    }
    if (!this.sessionId) {
      this.beginSession();
    }
    this.isRecording = true;
    this.attachListeners();
    this.scheduleFlush();
    vscode.window.setStatusBarMessage('Keystroke Capture: recording started', 2500);
  }

  stop() {
    if (!this.isRecording) {
      return;
    }
    this.isRecording = false;
    this.detachListeners();
    this.flush();
    vscode.window.setStatusBarMessage('Keystroke Capture: recording stopped', 2500);
  }

  newSession() {
    const wasRecording = this.isRecording;
    if (wasRecording) {
      this.stop();
    }
    this.sessionId = '';
    this.counts = { keystroke: 0, change: 0, selection: 0 };
    this.beginSession();
    if (wasRecording) {
      this.start();
    }
    vscode.window.showInformationMessage(`Keystroke Capture: new session ${this.sessionId}`);
  }

  dispose() {
    this.stop();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  getStorageDir() {
    const configured = String(
      vscode.workspace.getConfiguration('keystrokeCapture').get('storagePath', '') || ''
    ).trim();
    const dir = configured || path.join(this.context.globalStorageUri.fsPath, 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getCurrentFilePath() {
    return this.currentFilePath || '(no session yet)';
  }

  showStats() {
    const secs = this.sessionStartWall
      ? Math.round((Date.now() - this.sessionStartWall) / 1000)
      : 0;
    vscode.window.showInformationMessage(
      `Session ${this.sessionId || '(none)'} — ${this.counts.keystroke} keystrokes, ` +
        `${this.counts.change} edits, ${this.counts.selection} selection moves, ${secs}s elapsed.`
    );
  }

  beginSession() {
    this.sessionId = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    this.sessionStartWall = Date.now();
    this.sessionStartHr = process.hrtime.bigint();
    this.salt = crypto.randomBytes(16).toString('hex');

    const dir = this.getStorageDir();
    this.currentFilePath = path.join(dir, `session_${this.sessionId}.jsonl`);

    const header = {
      t: this.sessionStartWall,
      dt: 0,
      type: 'session_start',
      sessionId: this.sessionId,
      capturePolicy: this.policy(),
      vscodeVersion: vscode.version,
      platform: os.platform(),
      release: os.release(),
      host: vscode.env.appHost,
      machineId: vscode.env.machineId,
    };
    this.writeLine(JSON.stringify(header));
  }

  /** @returns {'full'|'categoryOnly'|'hashed'} */
  policy() {
    return vscode.workspace.getConfiguration('keystrokeCapture').get('capturePolicy', 'full');
  }

  attachListeners() {
    const cfg = vscode.workspace.getConfiguration('keystrokeCapture');

    // 1) Raw keystroke capture: intercept the editor 'type' command.
    // Fires for each character-producing keypress. Forward to the default
    // handler so typing behaves normally.
    try {
      this.typeCommandDisposable = vscode.commands.registerCommand('type', (args) => {
        this.onType((args && args.text) || '');
        return vscode.commands.executeCommand('default:type', args);
      });
    } catch (err) {
      // Another extension (e.g. Vim) already owns 'type'. Fall back to
      // document-change capture, which still records all inserted text.
      vscode.window.showWarningMessage(
        'Keystroke Capture: could not intercept the type command (another extension owns it). ' +
          'Falling back to document-change capture only.'
      );
    }

    // 2) Rich edit capture: every text document change.
    if (cfg.get('captureDocumentChanges', true)) {
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument((e) => this.onDocChange(e))
      );
    }

    // 3) Optional cursor/selection movement.
    if (cfg.get('captureSelectionChanges', false)) {
      this.disposables.push(
        vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e))
      );
    }

    // 4) Context: active editor changes.
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!this.isRecording) {
          return;
        }
        this.record(
          Object.assign(this.stamp('focus'), {
            file: editor ? this.fileLabel(editor.document) : null,
            lang: editor ? editor.document.languageId : null,
          })
        );
      })
    );
  }

  detachListeners() {
    if (this.typeCommandDisposable) {
      this.typeCommandDisposable.dispose();
      this.typeCommandDisposable = undefined;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  /** @param {string} text */
  onType(text) {
    if (!this.isRecording) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && this.isExcluded(editor.document)) {
      return;
    }
    const pos = editor ? editor.selection.active : undefined;
    this.counts.keystroke++;
    this.record(
      Object.assign(this.stamp('keystroke'), this.encodeText(text), {
        len: text.length,
        file: editor ? this.fileLabel(editor.document) : null,
        lang: editor ? editor.document.languageId : null,
        line: pos ? pos.line : null,
        col: pos ? pos.character : null,
      })
    );
  }

  /** @param {vscode.TextDocumentChangeEvent} e */
  onDocChange(e) {
    if (!this.isRecording || e.contentChanges.length === 0) {
      return;
    }
    if (this.isExcluded(e.document)) {
      return;
    }
    const changes = e.contentChanges.map((c) =>
      Object.assign(
        {
          offset: c.rangeOffset,
          rangeLen: c.rangeLength, // >0 means text was deleted/replaced
          insLen: c.text.length,
          startLine: c.range.start.line,
          startCol: c.range.start.character,
          endLine: c.range.end.line,
          endCol: c.range.end.character,
        },
        this.encodeText(c.text, 'ins')
      )
    );
    this.counts.change++;
    this.record(
      Object.assign(this.stamp('change'), {
        file: this.fileLabel(e.document),
        lang: e.document.languageId,
        reason: e.reason != null ? e.reason : null, // 1 = Undo, 2 = Redo
        changes,
      })
    );
  }

  /** @param {vscode.TextEditorSelectionChangeEvent} e */
  onSelection(e) {
    if (!this.isRecording) {
      return;
    }
    if (this.isExcluded(e.textEditor.document)) {
      return;
    }
    this.counts.selection++;
    this.record(
      Object.assign(this.stamp('selection'), {
        file: this.fileLabel(e.textEditor.document),
        kind: e.kind != null ? e.kind : null, // 1 keyboard, 2 mouse, 3 command
        selections: e.selections.map((s) => ({
          aLine: s.anchor.line,
          aCol: s.anchor.character,
          hLine: s.active.line,
          hCol: s.active.character,
        })),
      })
    );
  }

  // --- helpers ---

  /** @param {string} type */
  stamp(type) {
    const now = process.hrtime.bigint();
    const dt = Number(now - this.sessionStartHr) / 1e6; // ns -> ms
    return { t: Date.now(), dt: Math.round(dt * 1000) / 1000, type };
  }

  /**
   * Encode typed text according to the capture policy.
   * - full: literal text
   * - categoryOnly: category label per char (no content)
   * - hashed: short salted hash per char (identity/n-grams, not content)
   * @param {string} text
   * @param {string} [key]
   * @returns {Record<string, unknown>}
   */
  encodeText(text, key = 'text') {
    const policy = this.policy();
    if (policy === 'full') {
      return { [key]: text };
    }
    if (policy === 'categoryOnly') {
      return { [`${key}Cats`]: [...text].map((ch) => charCategory(ch)) };
    }
    // hashed
    return {
      [`${key}Hash`]: [...text].map((ch) =>
        crypto
          .createHash('sha256')
          .update(this.salt + ch)
          .digest('hex')
          .slice(0, 8)
      ),
    };
  }

  /** @param {vscode.TextDocument} doc */
  isExcluded(doc) {
    const pattern = String(
      vscode.workspace.getConfiguration('keystrokeCapture').get('excludeFilePattern', '') || ''
    ).trim();
    if (!pattern) {
      return false;
    }
    return doc.uri.fsPath.includes(pattern) || doc.uri.toString().includes(pattern);
  }

  /** @param {vscode.TextDocument} doc */
  fileLabel(doc) {
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    return rel || path.basename(doc.uri.fsPath);
  }

  /** @param {Record<string, unknown>} evt */
  record(evt) {
    this.buffer.push(JSON.stringify(evt));
    if (this.buffer.length >= 500) {
      this.flush();
    }
  }

  scheduleFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    const interval = Math.max(
      250,
      Number(vscode.workspace.getConfiguration('keystrokeCapture').get('flushIntervalMs', 2000))
    );
    this.flushTimer = setInterval(() => this.flush(), interval);
  }

  flush() {
    if (this.buffer.length === 0 || !this.currentFilePath) {
      return;
    }
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer = [];
    try {
      fs.appendFileSync(this.currentFilePath, chunk, { encoding: 'utf8' });
    } catch (err) {
      // Re-queue on failure so data isn't lost.
      this.buffer.unshift(chunk.trimEnd());
      console.error('Keystroke Capture: flush failed', err);
    }
  }

  /** @param {string} line */
  writeLine(line) {
    try {
      fs.appendFileSync(this.currentFilePath, line + '\n', { encoding: 'utf8' });
    } catch (err) {
      console.error('Keystroke Capture: write failed', err);
    }
  }
}

/** @param {string} ch */
function charCategory(ch) {
  if (ch === '') {
    return 'empty';
  }
  if (/\s/.test(ch)) {
    return ch === '\n' || ch === '\r' ? 'newline' : 'whitespace';
  }
  if (/[0-9]/.test(ch)) {
    return 'digit';
  }
  if (/[a-zA-Z]/.test(ch)) {
    return 'letter';
  }
  const code = ch.charCodeAt(0);
  if (code < 32) {
    return 'control';
  }
  return 'punct';
}

module.exports = { activate, deactivate };
