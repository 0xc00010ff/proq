import { NextResponse } from "next/server";
import { getProject, getAllAgents, getOrCreateDefaultAgent, createAgent } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Auto-create default agent if none exist
  let agents = await getAllAgents(id);
  if (agents.length === 0) {
    const defaultAgent = await getOrCreateDefaultAgent(id);
    agents = [defaultAgent];
  }

  return NextResponse.json(agents);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const { name, role, systemPrompt, avatar, position } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const agent = await createAgent(id, { name, role, systemPrompt, avatar, position });
  return NextResponse.json(agent, { status: 201 });
}
