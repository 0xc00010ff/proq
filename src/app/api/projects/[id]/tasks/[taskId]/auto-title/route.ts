import { NextResponse } from "next/server";
import { getTask } from "@/lib/db";
import { generateTitle } from "@/lib/auto-title";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const { description } = await request.json();

  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Don't overwrite a manually-set title
  if (task.title) {
    return NextResponse.json({ title: task.title });
  }

  const title = await generateTitle(id, taskId, description || task.description);
  return NextResponse.json({ title: title || null });
}
