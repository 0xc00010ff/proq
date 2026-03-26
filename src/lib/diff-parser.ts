export interface FileDiff {
  fileName: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: string;
}

/** Split a raw unified diff into per-file sections */
export function parseDiffIntoFiles(raw: string): FileDiff[] {
  if (!raw.trim()) return [];

  const files: FileDiff[] = [];
  // Split on "diff --git" boundaries
  const parts = raw.split(/^(?=diff --git )/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("diff --git ")) continue;

    const firstLine = trimmed.split("\n")[0];
    // Extract filename from "diff --git a/foo b/foo"
    const match = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    const fileName = match ? match[2] : "unknown";

    let status: FileDiff["status"] = "modified";
    if (trimmed.includes("\nnew file mode ")) status = "added";
    else if (trimmed.includes("\ndeleted file mode ")) status = "deleted";
    else if (trimmed.includes("\nrename from ")) status = "renamed";

    files.push({ fileName, status, hunks: trimmed });
  }

  return files;
}

/** Parse `git show` output into metadata + per-file diffs */
export function parseCommitShow(raw: string): {
  hash: string;
  author: string;
  date: string;
  message: string;
  files: FileDiff[];
} {
  // Split at the first "diff --git" boundary
  const diffStart = raw.indexOf("\ndiff --git ");
  const metaBlock = diffStart >= 0 ? raw.slice(0, diffStart) : raw;
  const diffBlock = diffStart >= 0 ? raw.slice(diffStart + 1) : "";

  // Parse metadata lines
  const lines = metaBlock.split("\n");
  let hash = "";
  let author = "";
  let date = "";
  const messageLines: string[] = [];
  let inMessage = false;

  for (const line of lines) {
    if (line.startsWith("commit ")) {
      hash = line.replace("commit ", "").trim().slice(0, 7);
    } else if (line.startsWith("Author: ")) {
      author = line.replace("Author: ", "").replace(/<.*>/, "").trim();
    } else if (line.startsWith("Date: ")) {
      date = line.replace("Date:", "").trim();
    } else if (line.startsWith("    ")) {
      inMessage = true;
      messageLines.push(line.trim());
    } else if (inMessage && line.trim() === "") {
      // End of message block
    }
  }

  return {
    hash,
    author,
    date,
    message: messageLines.join("\n"),
    files: parseDiffIntoFiles(diffBlock),
  };
}

/** Return a Tailwind color class for a diff line, or null for default */
export function colorDiffLine(line: string): string | null {
  if (line.startsWith("+") && !line.startsWith("+++")) return "text-green-700 dark:text-green-400";
  if (line.startsWith("-") && !line.startsWith("---")) return "text-red-700 dark:text-red-400";
  if (line.startsWith("@@")) return "text-blue-600 dark:text-blue-400";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  )
    return "text-text-tertiary";
  return null;
}
