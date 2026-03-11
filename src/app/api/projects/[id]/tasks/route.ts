import { NextResponse } from "next/server";
import { getAllTasks, createTask, getProject } from "@/lib/db";
import { emitTaskCreated } from "@/lib/task-events";

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

  const body = await request.json();
  const title = body.title ?? "";
  const description = body.description ?? "";
  const mode = body.mode;

  const task = await createTask(id, { title, description, mode });
  emitTaskCreated(id, task as unknown as Record<string, unknown>);
  return NextResponse.json(task, { status: 201 });
}
