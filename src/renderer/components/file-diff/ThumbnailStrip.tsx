import React from "react";

interface Props {
  data: string[];
}

export default function ThumbnailStrip({ data }: Props) {
  return (
    <div className="fd-thumbnail">
      {data.map((color, i) => (
        <div
          key={i}
          className="fd-thumb-line"
          style={{ background: color }}
          onClick={() => document.getElementById(`diff-row-${i}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
        />
      ))}
    </div>
  );
}
