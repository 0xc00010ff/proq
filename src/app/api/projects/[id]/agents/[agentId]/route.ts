import { NextResponse } from "next/server";
import { getProject, resolveAgent, updateAgent, deleteAgent } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string; agentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, agentId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const agent = await resolveAgent(id, agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json(agent);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, agentId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const updated = await updateAgent(id, agentId, body);
  if (!updated) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id, agentId } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const deleted = await deleteAgent(id, agentId);
  if (!deleted) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
