import { NextResponse } from "next/server";
import { getTask, getTaskSession } from "@/lib/db";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, taskId } = await params;
  const task = await getTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }
  const blocks = await getTaskSession(id, taskId);
  return NextResponse.json({ blocks });
}
