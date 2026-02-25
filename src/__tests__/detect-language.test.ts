import { describe, it, expect } from "vitest";
import { detectLanguage, formatHexOffset, formatByte } from "../renderer/utils/diff";

describe("detectLanguage", () => {
  const cases: [string, string][] = [
    ["/src/app.ts", "typescript"],
    ["/src/app.tsx", "typescript"],
    ["/src/main.js", "javascript"],
    ["/src/main.jsx", "javascript"],
    ["/src/main.py", "python"],
    ["/src/main.java", "java"],
    ["/src/main.cpp", "cpp"],
    ["/src/main.c", "c"],
    ["/src/main.cs", "csharp"],
    ["/src/main.go", "go"],
    ["/src/main.rs", "rust"],
    ["/src/main.rb", "ruby"],
    ["/src/main.swift", "swift"],
    ["/src/main.kt", "kotlin"],
    ["/src/main.sh", "bash"],
    ["/src/main.bash", "bash"],
    ["/Dockerfile", "dockerfile"],
    ["/src/main.css", "css"],
    ["/src/main.scss", "scss"],
    ["/src/main.html", "html"],
    ["/src/main.xml", "xml"],
    ["/src/main.json", "json"],
    ["/src/main.yaml", "yaml"],
    ["/src/main.yml", "yaml"],
    ["/src/main.md", "markdown"],
    ["/src/main.sql", "sql"],
    ["/src/main.php", "php"],
    ["/src/main.r", "r"],
    ["/src/main.lua", "lua"],
  ];

  it.each(cases)("maps %s → %s", (filePath, expected) => {
    expect(detectLanguage(filePath)).toBe(expected);
  });

  it("returns plaintext for unknown extensions", () => {
    expect(detectLanguage("/file.xyz")).toBe("plaintext");
  });

  it("is case-insensitive for extensions", () => {
    expect(detectLanguage("/file.TS")).toBe("typescript");
    expect(detectLanguage("/file.PY")).toBe("python");
  });
});

describe("formatHexOffset", () => {
  it("pads to 8 uppercase hex digits", () => {
    expect(formatHexOffset(0)).toBe("00000000");
    expect(formatHexOffset(255)).toBe("000000FF");
    expect(formatHexOffset(0x1000)).toBe("00001000");
  });
});

describe("formatByte", () => {
  it("formats byte as 2-digit uppercase hex", () => {
    expect(formatByte(0)).toBe("00");
    expect(formatByte(15)).toBe("0F");
    expect(formatByte(255)).toBe("FF");
  });
});
