import React, { useState, useEffect, useCallback } from "react";
import type { HexChunk, HexRow } from "@shared/types";
import { formatHexOffset, formatByte } from "../utils/diff";
import "./HexDiffView.css";

const BYTES_PER_ROW = 16;
const ROWS_PER_PAGE = 256; // 4 KB per page

interface Props {
  leftPath: string;
  rightPath: string;
}

export default function HexDiffView({ leftPath, rightPath }: Props) {
  const [leftChunk, setLeftChunk] = useState<HexChunk | null>(null);
  const [rightChunk, setRightChunk] = useState<HexChunk | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageSize = BYTES_PER_ROW * ROWS_PER_PAGE; // 4096 bytes

  const load = useCallback(
    async (off: number) => {
      if (!leftPath || !rightPath) return;
      setLoading(true);
      setError(null);
      try {
        const [left, right] = await Promise.all([
          window.electronAPI.fileReadHex(leftPath, off, pageSize),
          window.electronAPI.fileReadHex(rightPath, off, pageSize),
        ]);
        setLeftChunk(left);
        setRightChunk(right);
        setOffset(off);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [leftPath, rightPath, pageSize],
  );

  useEffect(() => {
    load(0);
  }, [leftPath, rightPath]);

  const totalSize = Math.max(leftChunk?.totalSize ?? 0, rightChunk?.totalSize ?? 0);
  const maxOffset = Math.max(0, totalSize - pageSize);
  const canPrev = offset > 0;
  const canNext = offset < maxOffset;

  const leftRows = leftChunk?.rows ?? [];
  const rightRows = rightChunk?.rows ?? [];
  const rowCount = Math.max(leftRows.length, rightRows.length);

  return (
    <div className="hex-diff">
      {/* Toolbar */}
      <div className="hd-toolbar">
        <button
          className="icon-btn"
          onClick={() => load(Math.max(0, offset - pageSize))}
          disabled={!canPrev || loading}
          data-tooltip="Previous Page"
        >
          ◀
        </button>
        <button
          className="icon-btn"
          onClick={() => load(Math.min(maxOffset, offset + pageSize))}
          disabled={!canNext || loading}
          data-tooltip="Next Page"
        >
          ▶
        </button>
        <span className="hd-info">
          {formatHexOffset(offset)} – {formatHexOffset(Math.min(offset + pageSize, totalSize))} of {totalSize.toLocaleString()} bytes
        </span>
      </div>

      {loading && <div className="hd-loading">Loading hex data…</div>}
      {error && <div className="hd-error">{error}</div>}

      {!loading && !error && rowCount > 0 && (
        <div className="hd-content">
          {/* Header */}
          <div className="hd-header">
            <span className="hd-offset-col">Offset</span>
            <span className="hd-bytes-col">
              {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                <span key={i} className="hd-byte-head">
                  {i.toString(16).toUpperCase().padStart(2, "0")}
                </span>
              ))}
            </span>
            <span className="hd-ascii-col">ASCII</span>
            <div className="hd-divider" />
            <span className="hd-offset-col">Offset</span>
            <span className="hd-bytes-col">
              {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
                <span key={i} className="hd-byte-head">
                  {i.toString(16).toUpperCase().padStart(2, "0")}
                </span>
              ))}
            </span>
            <span className="hd-ascii-col">ASCII</span>
          </div>

          {/* Rows */}
          <div className="hd-rows">
            {Array.from({ length: rowCount }, (_, i) => {
              const lr = leftRows[i];
              const rr = rightRows[i];
              return <HexRowPair key={i} left={lr ?? null} right={rr ?? null} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HexRowPair({ left, right }: { left: HexRow | null; right: HexRow | null }) {
  const isDiff = JSON.stringify(left?.bytes) !== JSON.stringify(right?.bytes);

  return (
    <div className={`hd-row${isDiff ? " hd-row--diff" : ""}`}>
      <HexRowCell row={left} side="left" diffRow={right} />
      <div className="hd-divider" />
      <HexRowCell row={right} side="right" diffRow={left} />
    </div>
  );
}

function HexRowCell({ row, side, diffRow }: { row: HexRow | null; side: "left" | "right"; diffRow: HexRow | null }) {
  if (!row) {
    // Padding row
    return (
      <div className="hd-row-cell hd-row-cell--empty">
        <span className="hd-offset-col">────────</span>
        <span className="hd-bytes-col">
          {Array.from({ length: BYTES_PER_ROW }, (_, i) => (
            <span key={i} className="hd-byte">
              {" "}
            </span>
          ))}
        </span>
        <span className="hd-ascii-col">{"·".repeat(BYTES_PER_ROW)}</span>
      </div>
    );
  }

  return (
    <div className="hd-row-cell">
      <span className="hd-offset-col">{formatHexOffset(row.offset)}</span>
      <span className="hd-bytes-col">
        {Array.from({ length: BYTES_PER_ROW }, (_, i) => {
          const b = row.bytes[i];
          const diffB = diffRow?.bytes[i];
          const differ = b !== undefined && diffB !== undefined && b !== diffB;
          const missing = b === undefined;
          return (
            <span key={i} className={`hd-byte${differ ? " hd-byte--diff" : ""}${missing ? " hd-byte--missing" : ""}`}>
              {b !== undefined ? formatByte(b) : "  "}
            </span>
          );
        })}
      </span>
      <span className="hd-ascii-col">{row.ascii}</span>
    </div>
  );
}
