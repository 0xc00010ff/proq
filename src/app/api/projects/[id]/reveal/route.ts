import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { getProject } from '@/lib/db';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  exec(`open ${JSON.stringify(project.path)}`);
  return NextResponse.json({ ok: true });
}
