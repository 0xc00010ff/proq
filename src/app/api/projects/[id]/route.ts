import { NextResponse } from "next/server";
import { getProject, updateProject, deleteProject, moveWorkspaceToProject } from "@/lib/db";
import { emitProjectUpdate } from "@/lib/task-events";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  // Strip internal _source flag before persisting
  const { _source, workspaceInProject, gitignoreWorkspace, ...fields } = body;

  // Handle workspace-to-project move
  if (workspaceInProject === true) {
    try {
      await moveWorkspaceToProject(id, gitignoreWorkspace === true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to move workspace";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const updated = await updateProject(id, fields);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Emit SSE for server-visible project changes (serverUrl, etc.)
  // so the frontend updates in real-time regardless of who made the change.
  emitProjectUpdate(id, fields);
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
