# Changelog

## 0.1.0

- Initial release.
- Keystroke capture via `type` command interception with sub-millisecond timing.
- Document-change capture (insert/delete/paste/autocomplete/multi-cursor).
- Optional selection/cursor movement capture.
- Capture policies: `full`, `categoryOnly`, `hashed`.
- Per-session JSONL output, buffered disk writes, status-bar recording indicator.
- File-exclusion pattern, configurable storage path.
- `tools/analyze.js` for inter-key-interval and typing-speed summaries.
