import { ipcMain, app } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { simpleGit, SimpleGit } from "simple-git";
import { GitRef, GitCompareResult, GitDiffItem, CompareState, CompareStats } from "../../shared/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function getTempDir(): string {
  const dir = path.join(os.tmpdir(), "macompare-git");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function registerGitHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GIT_IS_REPO, async (_event, dirPath: string) => {
    try {
      const git = simpleGit(dirPath);
      const isRepo = await git.checkIsRepo();
      return isRepo;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_LIST_REFS, async (_event, repoPath: string) => {
    try {
      const git = simpleGit(repoPath);
      const refs: GitRef[] = [];

      // Branches
      const branchResult = await git.branch(["-a"]);
      for (const [name, data] of Object.entries(branchResult.branches)) {
        refs.push({
          name,
          type: "branch",
          hash: data.commit,
          current: data.current,
        });
      }

      // Tags
      const tagResult = await git.tags();
      for (const tag of tagResult.all) {
        refs.push({ name: tag, type: "tag", hash: "" });
      }

      // Recent commits (last 20)
      const logResult = await git.log({ maxCount: 20 });
      for (const entry of logResult.all) {
        refs.push({
          name: `${entry.hash.substring(0, 8)} - ${entry.message.substring(0, 60)}`,
          type: "commit",
          hash: entry.hash,
        });
      }

      return refs;
    } catch (err: any) {
      throw new Error(`Failed to list refs: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_EXTRACT_FILE, async (_event, repoPath: string, ref: string, filePath: string) => {
    try {
      const git = simpleGit(repoPath);
      const content = await git.show([`${ref}:${filePath}`]);
      // Write to temp file
      const tempDir = getTempDir();
      const safeName = filePath.replace(/\//g, "_");
      const tempPath = path.join(tempDir, `${ref.replace(/\//g, "_")}_${safeName}`);
      await fs.promises.writeFile(tempPath, content, "utf-8");
      return tempPath;
    } catch (err: any) {
      throw new Error(`Failed to extract file: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.GIT_MERGE_BASE, async (_event, repoPath: string, ref1: string, ref2: string) => {
    try {
      const git = simpleGit(repoPath);
      const result = await git.raw(["merge-base", ref1, ref2]);
      return result.trim();
    } catch (err: any) {
      throw new Error(`Failed to compute merge-base: ${err.message}`);
    }
  });

  ipcMain.handle(IPC_CHANNELS.COMPARE_GIT, async (_event, repoPath: string, leftRef: string, rightRef: string) => {
    try {
      const git = simpleGit(repoPath);
      const diffSummary = await git.diffSummary([leftRef, rightRef]);
      const items: GitDiffItem[] = [];
      const stats: CompareStats = {
        equal: 0,
        modified: 0,
        onlyLeft: 0,
        onlyRight: 0,
        errors: 0,
        total: 0,
      };

      for (const file of diffSummary.files) {
        let state: CompareState;
        // Determine state from insertions/deletions
        const isText = "insertions" in file;
        const insertions = isText ? ((file as any).insertions as number) : 0;
        const deletions = isText ? ((file as any).deletions as number) : 0;
        if (insertions > 0 && deletions > 0) {
          state = CompareState.MODIFIED;
          stats.modified++;
        } else if (insertions > 0 && deletions === 0) {
          state = CompareState.ONLY_RIGHT;
          stats.onlyRight++;
        } else if (deletions > 0 && insertions === 0) {
          state = CompareState.ONLY_LEFT;
          stats.onlyLeft++;
        } else {
          state = CompareState.MODIFIED;
          stats.modified++;
        }

        items.push({
          relativePath: file.file,
          name: path.basename(file.file),
          state,
          type: "file",
        });
        stats.total++;
      }

      const result: GitCompareResult = {
        repoPath,
        leftRef,
        rightRef,
        items,
        stats,
      };
      return result;
    } catch (err: any) {
      throw new Error(`Git compare failed: ${err.message}`);
    }
  });
}
