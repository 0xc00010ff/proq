import { NextResponse } from "next/server";

/**
 * Safely parse JSON from a request body.
 * Returns the parsed body, or a 400 NextResponse if the JSON is malformed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function safeParseBody<T = any>(
  request: Request
): Promise<T | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }
}
