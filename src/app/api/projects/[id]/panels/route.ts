import { NextResponse } from "next/server";
import { getProjectPanels, setProjectPanels } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";
import type { PanelLayout, PanelState } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

const SLOTS = ['upperLeft', 'upperRight', 'lower'] as const;
const KINDS = new Set(['kanban', 'live', 'code', 'agents-workbench', 'agent-editor']);

function isValidPanel(p: unknown): p is PanelState {
  if (!p || typeof p !== 'object') return false;
  const ps = p as Record<string, unknown>;
  if (typeof ps.visible !== 'boolean') return false;
  if (typeof ps.sizePct !== 'number' || !Number.isFinite(ps.sizePct)) return false;
  const view = ps.view as { kind?: unknown } | undefined;
  if (!view || typeof view !== 'object' || typeof view.kind !== 'string') return false;
  return KINDS.has(view.kind);
}

function isValidLayout(layout: unknown): layout is PanelLayout {
  if (!layout || typeof layout !== 'object') return false;
  for (const slot of SLOTS) {
    if (!isValidPanel((layout as Record<string, unknown>)[slot])) return false;
  }
  return true;
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const panels = await getProjectPanels(id);
  return NextResponse.json(panels);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  if (!isValidLayout(body)) {
    return NextResponse.json({ error: "Invalid panel layout" }, { status: 400 });
  }
  const saved = await setProjectPanels(id, body);
  return NextResponse.json(saved);
}
