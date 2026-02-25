import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../renderer/store/session-store";

// Reset store state before each test
beforeEach(() => {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
  });
});

describe("createFolderSession", () => {
  it("creates a session with type folder", () => {
    const { createFolderSession, sessions } = useSessionStore.getState();
    createFolderSession("/a", "/b");
    const s = useSessionStore.getState().sessions;
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("folder");
  });

  it("stores left and right paths", () => {
    useSessionStore.getState().createFolderSession("/left", "/right");
    const s = useSessionStore.getState().sessions[0];
    expect(s.leftPath).toBe("/left");
    expect(s.rightPath).toBe("/right");
  });

  it("sets the new session as active", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    const { activeSessionId, sessions } = useSessionStore.getState();
    expect(activeSessionId).toBe(sessions[0].id);
  });

  it("can create multiple sessions", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    useSessionStore.getState().createFolderSession("/c", "/d");
    expect(useSessionStore.getState().sessions).toHaveLength(2);
  });
});

describe("createFileSession", () => {
  it("creates a session with type file", () => {
    useSessionStore.getState().createFileSession("/a.ts", "/b.ts");
    const s = useSessionStore.getState().sessions[0];
    expect(s.type).toBe("file");
  });

  it("stores file paths", () => {
    useSessionStore.getState().createFileSession("/left.ts", "/right.ts");
    const s = useSessionStore.getState().sessions[0];
    expect(s.leftPath).toBe("/left.ts");
    expect(s.rightPath).toBe("/right.ts");
  });
});

describe("closeSession", () => {
  it("removes the session list", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    const id = useSessionStore.getState().sessions[0].id;
    useSessionStore.getState().closeSession(id);
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it("sets activeSessionId to the previous session when closing the active one", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    useSessionStore.getState().createFolderSession("/c", "/d");
    const sessions = useSessionStore.getState().sessions;
    useSessionStore.setState({ activeSessionId: sessions[1].id });
    useSessionStore.getState().closeSession(sessions[1].id);
    expect(useSessionStore.getState().activeSessionId).toBe(sessions[0].id);
  });

  it("sets activeSessionId to null when last session is closed", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    const id = useSessionStore.getState().sessions[0].id;
    useSessionStore.getState().closeSession(id);
    expect(useSessionStore.getState().activeSessionId).toBeNull();
  });

  it("does nothing for unknown id", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    useSessionStore.getState().closeSession("non-existent-id");
    expect(useSessionStore.getState().sessions).toHaveLength(1);
  });
});

describe("setActiveSession", () => {
  it("updates activeSessionId", () => {
    useSessionStore.getState().createFolderSession("/a", "/b");
    useSessionStore.getState().createFolderSession("/c", "/d");
    const sessions = useSessionStore.getState().sessions;
    useSessionStore.getState().setActiveSession(sessions[0].id);
    expect(useSessionStore.getState().activeSessionId).toBe(sessions[0].id);
  });
});
