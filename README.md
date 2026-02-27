# myCompare

A modern file, folder, and Git comparison tool for macOS — built with Electron, React, and TypeScript.

**Author:** Tony Xu · [tony@tarch.ca](mailto:tony@tarch.ca)  
**License:** MIT

---

## Features

**File Compare:** Side-by-side text diff with syntax highlighting (30+ languages), whitespace-only diff detection, hex viewer for binary files.

**Folder Compare:** Visual state indicators (equal, modified, only-left, only-right), directory state aggregation, fixed-width metadata columns, drag-and-drop support.

**Git Compare:** Tree view of changes between any two refs (branches, tags, commits).

**General:** Multi-tab persistent sessions, dark/light theme, macOS native title bar.

---

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10
- macOS

### Install

```bash
git clone https://github.com/fihtony/myCompare.git
cd myCompare
npm install
```

### Develop

```bash
npm run dev
```

Starts the Vite dev server, compiles TypeScript, and launches Electron.

### Build for macOS

```bash
npm run dist:mac
```

Creates a universal (arm64 + x64) `.dmg` installer in `dist/`.

---

## Tech Stack

- **Shell:** Electron 40
- **UI:** React 18 + TypeScript
- **Build:** Vite 7
- **Diff:** Custom Myers-diff algorithm
- **Highlighting:** highlight.js
- **Git:** simple-git
- **State:** Zustand
- **Packaging:** electron-builder

---

## License

MIT © 2026 Tony Xu
