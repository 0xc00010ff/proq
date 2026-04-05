import type { TaskAttachment } from "./types";

/**
 * Upload files to the server and return TaskAttachment objects with filePath set.
 * Pass projectId to store attachments in the project directory.
 */
export async function uploadFiles(files: FileList | File[], projectId?: string): Promise<TaskAttachment[]> {
  const formData = new FormData();
  for (const f of Array.from(files)) {
    formData.append("files", f);
  }
  if (projectId) {
    formData.append("projectId", projectId);
  }
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

/**
 * Get a URL that serves an attachment file for display in the browser.
 * Handles both project-scoped and global attachment paths.
 */
export function attachmentUrl(filePath: string): string {
  // Project-scoped: /Users/.../data/projects/{projectId}/attachments/{id}/{name}
  const projectMarker = "data/projects/";
  const projectIdx = filePath.indexOf(projectMarker);
  if (projectIdx !== -1) {
    const rest = filePath.slice(projectIdx + projectMarker.length);
    // rest is "{projectId}/attachments/{id}/{name}"
    const attMarker = "/attachments/";
    const attIdx = rest.indexOf(attMarker);
    if (attIdx !== -1) {
      const projectId = rest.slice(0, attIdx);
      const attPath = rest.slice(attIdx + attMarker.length);
      return `/api/attachments/${projectId}/${attPath}`;
    }
  }

  // Supervisor: /Users/.../data/supervisor/attachments/{id}/{name}
  const supMarker = "data/supervisor/attachments/";
  const supIdx = filePath.indexOf(supMarker);
  if (supIdx !== -1) {
    return `/api/attachments/${filePath.slice(supIdx + supMarker.length)}`;
  }

  // Legacy global: /Users/.../data/attachments/{id}/{name}
  const marker = "data/attachments/";
  const idx = filePath.indexOf(marker);
  if (idx === -1) return filePath;
  return `/api/attachments/${filePath.slice(idx + marker.length)}`;
}
