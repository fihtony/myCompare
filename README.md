# maCompare

A Beyond Compare-like file/folder/Git comparison desktop tool built with Electron, React, and TypeScript.

**Owner:** Tony Xu (tony@tarch.ca)  
**License:** MIT  
**Status:** Production-ready (114/114 tests passing)

## Features

### Folder Compare
- Compare two directories with visual state indicators (equal, modified, only-left, only-right)
- Hidden file toggle with cascade hide for directory descendants
- Directory state aggregation from children
- Orphan item striping for non-matching sides
- Fixed-width metadata columns (size, modification time)

### File Compare
- Side-by-side text diff with syntax highlighting (30+ languages)
- **Whitespace-only diff** detection with visual indicators
- Multi-line **section copy** to either side
- **Undo/redo stack** (Ctrl/Cmd+Z) with 100-step history
- File metadata footer bar (size, line count, modification time, read-only/hidden badges)
- Always-visible save buttons with unsaved state indication
--------------------------------------------------------om--------ompar--------------------------------------------------------om--------ompar---------------------------------ope--------------------------------file ----------------
#####################################################l h#######ting)
############### fil############### fil############### fil############### fil############### fil############### fipp############### fil############### fil############### fil####### ############### fil############### fiinclude############### fil############### fil######etup

```bash
npm install
npm run dev
```

Starts dev server, main process inStarts dev server, main process inStarts dev server, main procesommand | Purpose |
|---------|---------|
| `npm run dev` | Development mode (hot-reload + DevTools) |
| `np| `np| `np| `np| `np| `np| `np| `np| `np| `np| `np|m start` | Launch production build |
| `npm test` | Run test suite (114 tests) |
| `npm run test:watch` | Watch mode for tests |

## Usage

**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comp F**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**s w**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comparing Fold**Comp F**Comparing Fold**Cfeature**CompCl**Comparinow**Compar inline diff

## Project Structure

```
src/
├── main/              # Electron main process
├── renderer/          # React UI (TSX + CSS├── renderer/          # React UI (TSX + CSS├──── __tests__/         # 114 Vitest unit/integration tests

docs/                  # Design & implementation docs
data/                  # Test fixtures
```

## Technical Stack

- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40- **Electron** 40-on'- **Electron** 40-~/.macom- *e-sessions.json` (corrupted session); rebuild with `npm run build` |

## License

See [LICENSE](LICENSE) for details.

For issues, feature requests, or documentation, check the `docs/` folder.
