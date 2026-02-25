import React from "react";
import type { Session } from "@shared/types";
import FolderCompareView from "./FolderCompareView";
import FileDiffView from "./FileDiffView";
import GitCompareView from "./GitCompareView";

interface Props {
  session: Session;
}

export default function SessionContent({ session }: Props) {
  switch (session.type) {
    case "folder":
      return <FolderCompareView session={session} />;
    case "file":
      return <FileDiffView session={session} />;
    case "git":
      return <GitCompareView session={session} />;
    default:
      return <div style={{ padding: 20 }}>Unknown session type</div>;
  }
}
