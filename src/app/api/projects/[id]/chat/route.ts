import { NextResponse } from "next/server";
import { getChatLog, addChatMessage, getProject } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const log = await getChatLog(id);
  return NextResponse.json(log);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { role, message, toolCalls, attachments } = body;

  if (!role || !message) {
    return NextResponse.json(
      { error: "role and message are required" },
      { status: 400 }
    );
  }

  const entry = await addChatMessage(id, { role, message, toolCalls, attachments });
  return NextResponse.json(entry, { status: 201 });
}
