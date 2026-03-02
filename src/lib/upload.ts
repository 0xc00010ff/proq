import type { TaskAttachment } from "./types";

/**
 * Upload files to the server and return TaskAttachment objects with filePath set.
 */
export async function uploadFiles(files: FileList | File[]): Promise<TaskAttachment[]> {
  const formData = new FormData();
  for (const f of Array.from(files)) {
    formData.append("files", f);
  }
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

/**
 * Get a URL that serves an attachment file for display in the browser.
 */
export function attachmentUrl(filePath: string): string {
  // filePath is absolute like /Users/.../data/attachments/{id}/{name}
  // Extract the part after "data/attachments/"
  const marker = "data/attachments/";
  const idx = filePath.indexOf(marker);
  if (idx === -1) return filePath;
  return `/api/attachments/${filePath.slice(idx + marker.length)}`;
}
