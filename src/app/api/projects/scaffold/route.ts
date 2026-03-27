import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { createProject, createTask, updateTask, createCronJob } from "@/lib/db";
import { initForDispatch } from "@/lib/task-lifecycle";
import { processQueue } from "@/lib/agent-dispatch";
import { emitTaskCreated, emitTaskUpdate } from "@/lib/task-events";
import { ensureCronSchedulerStarted } from "@/lib/cron-scheduler";
import { safeParseBody } from "@/lib/api-utils";
import { resolveProjectPath } from "@/lib/utils";
import { generateFiles, generateFirstTaskPrompt } from "@/lib/templates";
import type { ScaffoldInput } from "@/lib/templates";

export async function POST(request: Request) {
  const body = await safeParseBody(request);
  if (body instanceof NextResponse) return body;

  const {
    templateId,
    projectName,
    location,
    description,
    stackOverride,
    toggles = {},
    schedule,
  } = body as ScaffoldInput;

  if (!projectName || !location) {
    return NextResponse.json(
      { error: "projectName and location are required" },
      { status: 400 },
    );
  }

  const resolvedLocation = resolveProjectPath(location);
  const projectDir = join(resolvedLocation, projectName);

  // Don't overwrite existing directories
  if (existsSync(projectDir)) {
    return NextResponse.json(
      { error: `Directory already exists: ${projectDir}` },
      { status: 409 },
    );
  }

  try {
    // 1. Create project directory
    mkdirSync(projectDir, { recursive: true });

    // 2. Write scaffold files
    const input: ScaffoldInput = {
      templateId,
      projectName,
      location: resolvedLocation,
      description,
      stackOverride,
      toggles,
      schedule,
    };
    const files = generateFiles(input);

    for (const file of files) {
      const filePath = join(projectDir, file.path);
      const dir = dirname(filePath);
      if (dir !== projectDir) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, file.content, "utf-8");
    }

    // 3. git init + initial commit
    execSync("git init", { cwd: projectDir, stdio: "pipe" });
    execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
    execSync('git commit -m "Initial scaffold"', {
      cwd: projectDir,
      stdio: "pipe",
    });

    // 4. Add project to proq
    const project = await createProject({
      name: projectName,
      path: projectDir,
    });

    // 5. Create first task
    const taskPrompt = generateFirstTaskPrompt(input);
    const task = await createTask(project.id, {
      title: "Initialize and set up this project",
      description: taskPrompt,
      mode: "auto",
    });

    emitTaskCreated(
      project.id,
      task as unknown as Record<string, unknown>,
    );

    // 6. For research agent: create cron job
    if (templateId === "research-agent" && schedule) {
      await createCronJob(project.id, {
        name: projectName,
        prompt: description || "Run the research task as described in CLAUDE.md",
        schedule,
        mode: "auto",
        enabled: true,
      });
      ensureCronSchedulerStarted();
    }

    // 7. Dispatch the first task (move to in-progress, then queue for agent)
    await updateTask(project.id, task.id, { status: "in-progress" });
    const changes = await initForDispatch(
      project.id,
      task.id,
      { ...task, status: "in-progress" },
      "todo",
    );
    if (changes.agentStatus) {
      emitTaskUpdate(project.id, task.id, {
        status: "in-progress",
        ...changes,
      });
    }
    await processQueue(project.id);

    return NextResponse.json(
      { ...project, pathValid: true },
      { status: 201 },
    );
  } catch (err) {
    // Clean up on failure — remove the partially created directory
    try {
      execSync(`rm -rf ${JSON.stringify(projectDir)}`, { stdio: "pipe" });
    } catch {
      // best effort cleanup
    }
    console.error("[scaffold] failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to scaffold project",
      },
      { status: 500 },
    );
  }
}
