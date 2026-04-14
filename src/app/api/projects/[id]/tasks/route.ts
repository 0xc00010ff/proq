import { NextResponse } from "next/server";
import { getAllTasks, createTask, getProject } from "@/lib/db";
import { emitTaskCreated } from "@/lib/task-events";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const columns = await getAllTasks(id);
  return NextResponse.json(columns);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const title = body.title ?? "";
  const description = body.description ?? "";
  const mode = body.mode;
  const agentId = body.agentId;

  const task = await createTask(id, { title, description, mode, agentId });
  emitTaskCreated(id, task as unknown as Record<string, unknown>);
  return NextResponse.json(task, { status: 201 });
}
