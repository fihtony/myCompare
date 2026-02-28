import React from "react";
import type { FileStatInfo } from "@shared/types";
import { formatSize, formatDate } from "./utils";

interface Props {
  leftContent: string;
  rightContent: string;
  leftStat: FileStatInfo | null;
  rightStat: FileStatInfo | null;
  diffCount: number;
}

export default function DiffFootbar({ leftContent, rightContent, leftStat, rightStat, diffCount }: Props) {
  if (!leftContent && !rightContent) return null;
  return (
    <div className="fd-footbar">
      <div className="fd-foot-side">
        {leftStat ? (
          <>
            <span>{formatSize(leftStat.size)}</span>
            <span className="fd-foot-sep">·</span>
            <span>{leftContent.split("\n").length} lines</span>
            <span className="fd-foot-sep">·</span>
            <span title="Modified">{formatDate(leftStat.mtime)}</span>
            {leftStat.birthtime !== leftStat.mtime && (
              <span title={`Created ${formatDate(leftStat.birthtime)}`} className="fd-foot-muted">
                {" "}
                ({formatDate(leftStat.birthtime)} created)
              </span>
            )}
            {leftStat.readonly && <span className="fd-foot-badge">RO</span>}
            {leftStat.hidden && <span className="fd-foot-badge">Hidden</span>}
          </>
        ) : (
          <span className="fd-foot-muted">{leftContent.split("\n").length} lines</span>
        )}
      </div>

      <div className="fd-foot-center">
        {diffCount === 0 ? (
          <span className="fd-foot-identical">Identical</span>
        ) : (
          <span>
            {diffCount} difference{diffCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="fd-foot-side fd-foot-right">
        {rightStat ? (
          <>
            {rightStat.readonly && <span className="fd-foot-badge">RO</span>}
            {rightStat.hidden && <span className="fd-foot-badge">Hidden</span>}
            <span title="Modified">{formatDate(rightStat.mtime)}</span>
            <span className="fd-foot-sep">·</span>
            <span>{rightContent.split("\n").length} lines</span>
            <span className="fd-foot-sep">·</span>
            <span>{formatSize(rightStat.size)}</span>
          </>
        ) : (
          <span className="fd-foot-muted">{rightContent.split("\n").length} lines</span>
        )}
      </div>
    </div>
  );
}
