import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST() {
  try {
    const script = `
      set chosenFile to choose file with prompt "Select a file to preview"
      return POSIX path of chosenFile
    `;
    const result = execSync(`osascript -e '${script}'`, {
      encoding: "utf-8",
      timeout: 60000,
    }).trim();

    const filePath = result.endsWith("/") ? result.slice(0, -1) : result;
    const fileName = filePath.split("/").pop() || filePath;

    return NextResponse.json({ path: filePath, name: fileName });
  } catch {
    return NextResponse.json({ cancelled: true });
  }
}
