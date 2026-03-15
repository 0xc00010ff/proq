import { NextResponse } from "next/server";
import { reorderProjects } from "@/lib/db";
import { safeParseBody } from "@/lib/api-utils";

export async function PUT(request: Request) {
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds)) {
    return NextResponse.json(
      { error: "orderedIds array is required" },
      { status: 400 }
    );
  }

  await reorderProjects(orderedIds);
  return NextResponse.json({ success: true });
}
