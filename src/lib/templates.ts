/**
 * Template definitions for new project scaffolding.
 * Each template defines its UI configuration (toggles, fields) and
 * generator functions that produce the files to write on disk.
 */

// ── Types ────────────────────────────────────────────────

export interface TemplateToggle {
  id: string;
  label: string;
  description?: string;
  defaultOn: boolean;
  /** When on, show a text field for user input */
  hasTextField?: boolean;
  /** Placeholder for the text field */
  placeholder?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  subtitle: string;
  /** Lucide icon name */
  icon: string;
  /** Default stack line shown at top of config */
  defaultStack?: string;
  /** Whether the stack line is editable */
  stackEditable?: boolean;
  /** Main text area label */
  descriptionLabel?: string;
  /** Main text area placeholder */
  descriptionPlaceholder?: string;
  /** Example suggestions shown below the text area */
  descriptionExamples?: string[];
  /** Schedule input (Research Agent only) */
  hasSchedule?: boolean;
  schedulePlaceholder?: string;
  /** Toggles for this template */
  toggles: TemplateToggle[];
}

export interface ScaffoldInput {
  templateId: string;
  projectName: string;
  location: string;
  description?: string;
  stackOverride?: string;
  toggles: Record<string, { enabled: boolean; value?: string }>;
  schedule?: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

// ── Template Definitions ─────────────────────────────────

export const templates: TemplateDefinition[] = [
  {
    id: "blank",
    name: "Blank",
    subtitle: "Empty project",
    icon: "FileIcon",
    toggles: [],
  },
  {
    id: "web-app",
    name: "Web App",
    subtitle: "Next.js, Tailwind, TypeScript",
    icon: "GlobeIcon",
    defaultStack: "Next.js, Tailwind, TypeScript",
    stackEditable: true,
    descriptionLabel: "What are you building?",
    descriptionPlaceholder:
      "e.g. App for monitoring the macroeconomic and geopolitical situation",
    toggles: [
      {
        id: "auth",
        label: "Auth",
        defaultOn: false,
        hasTextField: true,
        placeholder: "NextAuth.js, Auth0, Clerk...",
      },
      {
        id: "database",
        label: "Database",
        defaultOn: false,
        hasTextField: true,
        placeholder: "Prisma + SQLite, Supabase, Convex...",
      },
      {
        id: "animations",
        label: "Basic animations",
        description: "Framer Motion, page transitions, micro-interactions",
        defaultOn: false,
      },
      {
        id: "vfx",
        label: "Advanced VFX",
        description: "GLSL shaders, post-processing, particle systems",
        defaultOn: false,
      },
      {
        id: "3d",
        label: "3D rendering",
        description: "Three.js, scene, camera, lighting",
        defaultOn: false,
      },
    ],
  },
  {
    id: "data-ml",
    name: "Data & ML",
    subtitle: "Python, notebooks, automation",
    icon: "BrainIcon",
    defaultStack: "Python, venv",
    stackEditable: true,
    descriptionLabel: "What are you building?",
    descriptionPlaceholder:
      "e.g. Sentiment analysis pipeline for customer reviews",
    toggles: [
      {
        id: "notebook",
        label: "Notebook",
        description: "Jupyter, starter .ipynb",
        defaultOn: true,
      },
      {
        id: "data-analysis",
        label: "Data analysis",
        description: "pandas, matplotlib",
        defaultOn: true,
      },
      {
        id: "pytorch",
        label: "PyTorch",
        description: "torch, starter training script",
        defaultOn: false,
      },
      {
        id: "scraping",
        label: "Scraping",
        description: "requests, BeautifulSoup",
        defaultOn: false,
      },
    ],
  },
  {
    id: "notes",
    name: "Notes",
    subtitle: "Markdown, artifacts, ideation",
    icon: "NotebookPenIcon",
    descriptionLabel: "What is this for?",
    descriptionPlaceholder: "e.g. Planning out a new product strategy",
    toggles: [
      {
        id: "image-gen",
        label: "Image generation",
        defaultOn: false,
        hasTextField: true,
        placeholder: "nanobanana, Midjourney...",
      },
      {
        id: "diagrams",
        label: "Technical diagrams",
        description: "Mermaid templates",
        defaultOn: false,
      },
    ],
  },
  {
    id: "research-agent",
    name: "Research Agent",
    subtitle: "Describe a job, set a schedule, it runs",
    icon: "SearchIcon",
    descriptionLabel: "What should your agent do?",
    descriptionPlaceholder:
      "e.g. Summarize the top economic and tech news stories each morning",
    descriptionExamples: [
      "Summarize the top economic and tech stories each morning",
      "Check these 3 competitor websites and note what's changed",
      "Find new arxiv papers about [topic] and summarize",
    ],
    hasSchedule: true,
    schedulePlaceholder: "Every weekday morning at 9am PST",
    toggles: [],
  },
];

// ── File Generators ──────────────────────────────────────

export function generateFiles(input: ScaffoldInput): ScaffoldFile[] {
  switch (input.templateId) {
    case "blank":
      return generateBlankFiles(input);
    case "web-app":
      return generateWebAppFiles(input);
    case "data-ml":
      return generateDataMLFiles(input);
    case "notes":
      return generateNotesFiles(input);
    case "research-agent":
      return generateResearchAgentFiles(input);
    default:
      return generateBlankFiles(input);
  }
}

// ── Blank ────────────────────────────────────────────────

function generateBlankFiles(input: ScaffoldInput): ScaffoldFile[] {
  return [
    { path: ".gitignore", content: gitignoreGeneric() },
    { path: "CLAUDE.md", content: claudeMdBlank(input) },
    { path: "README.md", content: readmeMd(input) },
  ];
}

function claudeMdBlank(input: ScaffoldInput): string {
  return `# ${input.projectName}

${input.description ? input.description + "\n" : ""}
## Getting Started

This is a new project. Start by defining the structure and goals.

## Conventions

- Keep the project organized and well-documented
- Update this file as the project evolves
`;
}

// ── Web App ──────────────────────────────────────────────

function generateWebAppFiles(input: ScaffoldInput): ScaffoldFile[] {
  const stack = input.stackOverride || "Next.js, Tailwind, TypeScript";
  const files: ScaffoldFile[] = [
    { path: ".gitignore", content: gitignoreNode() },
    { path: "CLAUDE.md", content: claudeMdWebApp(input, stack) },
    { path: "README.md", content: readmeMd(input) },
    { path: "package.json", content: packageJsonWebApp(input, stack) },
    { path: "tsconfig.json", content: tsconfigWebApp() },
  ];
  return files;
}

function packageJsonWebApp(input: ScaffoldInput, stack: string): string {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};

  // Core deps based on stack
  const s = stack.toLowerCase();
  if (s.includes("next")) {
    deps["next"] = "latest";
    deps["react"] = "latest";
    deps["react-dom"] = "latest";
  }
  if (s.includes("tailwind")) {
    devDeps["tailwindcss"] = "latest";
    devDeps["@tailwindcss/postcss"] = "latest";
    devDeps["postcss"] = "latest";
  }
  if (s.includes("typescript")) {
    devDeps["typescript"] = "latest";
    devDeps["@types/react"] = "latest";
    devDeps["@types/react-dom"] = "latest";
    devDeps["@types/node"] = "latest";
  }
  if (s.includes("vite")) {
    deps["vite"] = "latest";
  }

  // Toggle deps
  const toggles = input.toggles;
  if (toggles.animations?.enabled) {
    deps["framer-motion"] = "latest";
  }
  if (toggles.vfx?.enabled) {
    deps["three"] = "latest";
    deps["@react-three/fiber"] = "latest";
    deps["@react-three/postprocessing"] = "latest";
    devDeps["@types/three"] = "latest";
  }
  if (toggles["3d"]?.enabled) {
    deps["three"] = "latest";
    deps["@react-three/fiber"] = "latest";
    deps["@react-three/drei"] = "latest";
    devDeps["@types/three"] = "latest";
  }

  const scripts: Record<string, string> = {};
  if (s.includes("next")) {
    scripts["dev"] = "next dev";
    scripts["build"] = "next build";
    scripts["start"] = "next start";
    scripts["lint"] = "next lint";
  } else if (s.includes("vite")) {
    scripts["dev"] = "vite";
    scripts["build"] = "vite build";
    scripts["preview"] = "vite preview";
  }

  return JSON.stringify(
    {
      name: input.projectName.toLowerCase().replace(/\s+/g, "-"),
      version: "0.1.0",
      private: true,
      scripts,
      dependencies: deps,
      devDependencies: devDeps,
    },
    null,
    2,
  );
}

function tsconfigWebApp(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
      exclude: ["node_modules"],
    },
    null,
    2,
  );
}

function claudeMdWebApp(input: ScaffoldInput, stack: string): string {
  const toggles = input.toggles;
  const sections: string[] = [];

  sections.push(`# ${input.projectName}`);
  sections.push("");
  if (input.description) {
    sections.push(input.description);
    sections.push("");
  }
  sections.push(`**Stack:** ${stack}`);
  sections.push("");

  // Quick start
  const s = stack.toLowerCase();
  sections.push("## Quick Start");
  sections.push("");
  sections.push("```bash");
  sections.push("npm install");
  if (s.includes("next") || s.includes("vite")) {
    sections.push("npm run dev");
  }
  sections.push("```");
  sections.push("");

  // Design system — always included
  sections.push("## Design System");
  sections.push("");
  sections.push(
    "This project uses a design system. Create and maintain a design system file (`src/design-system.md` or similar) that defines:",
  );
  sections.push("");
  sections.push(
    "- **Theme tokens**: colors, spacing, typography, border radii, shadows",
  );
  sections.push(
    "- **Component conventions**: naming patterns, prop interfaces, composition rules",
  );
  sections.push(
    "- **Layout patterns**: grid system, responsive breakpoints, container widths",
  );
  sections.push("- **Motion**: transition durations, easing curves, animation patterns");
  sections.push("");
  sections.push(
    "When building any UI component, always reference the design system first. If a token or pattern doesn't exist yet, add it to the design system before using it in a component. Keep the design system as the single source of truth for all visual decisions.",
  );
  sections.push("");
  sections.push(
    "When updating the design system, ensure all existing components still conform to the updated tokens. The design system should evolve with the project — not be a static document.",
  );
  sections.push("");

  // Auth section
  if (toggles.auth?.enabled) {
    const authTech = toggles.auth.value || "your chosen auth provider";
    sections.push("## Authentication");
    sections.push("");
    sections.push(
      `Set up authentication using ${authTech}. Implement login, logout, session management, and protected routes.`,
    );
    sections.push("");
  }

  // Database section
  if (toggles.database?.enabled) {
    const dbTech = toggles.database.value || "your chosen database";
    sections.push("## Database");
    sections.push("");
    sections.push(
      `Set up the database layer using ${dbTech}. Create the schema, migrations, and data access patterns.`,
    );
    sections.push("");
  }

  // Animations
  if (toggles.animations?.enabled) {
    sections.push("## Animations");
    sections.push("");
    sections.push(
      "Use Framer Motion for animations. Include page transitions, micro-interactions on buttons and cards, and smooth layout animations. Keep animations subtle and purposeful.",
    );
    sections.push("");
  }

  // VFX
  if (toggles.vfx?.enabled) {
    sections.push("## Advanced VFX");
    sections.push("");
    sections.push(
      "This project includes advanced visual effects. Use GLSL shaders, post-processing effects, and particle systems where appropriate. Set up a shader pipeline with hot-reloading for development.",
    );
    sections.push("");
  }

  // 3D
  if (toggles["3d"]?.enabled) {
    sections.push("## 3D Rendering");
    sections.push("");
    sections.push(
      "Set up Three.js with React Three Fiber. Include a basic scene with camera, lighting, and controls. Use @react-three/drei for common 3D helpers.",
    );
    sections.push("");
  }

  // Conventions
  sections.push("## Conventions");
  sections.push("");
  sections.push("- Use TypeScript strict mode");
  sections.push("- Components in PascalCase, one component per file");
  sections.push("- Colocate tests with source files");
  sections.push("- Use CSS modules or Tailwind utility classes — no inline styles");
  sections.push("- Keep components small and composable");
  sections.push("- Prefer server components where possible (Next.js)");
  sections.push("");

  return sections.join("\n");
}

// ── Data & ML ────────────────────────────────────────────

function generateDataMLFiles(input: ScaffoldInput): ScaffoldFile[] {
  const files: ScaffoldFile[] = [
    { path: ".gitignore", content: gitignorePython() },
    { path: "CLAUDE.md", content: claudeMdDataML(input) },
    { path: "README.md", content: readmeMd(input) },
    { path: "requirements.txt", content: requirementsTxt(input) },
  ];

  if (input.toggles.notebook?.enabled) {
    files.push({
      path: "notebooks/exploration.ipynb",
      content: starterNotebook(input.projectName),
    });
  }

  return files;
}

function requirementsTxt(input: ScaffoldInput): string {
  const lines: string[] = [];
  if (input.toggles["data-analysis"]?.enabled) {
    lines.push("pandas", "matplotlib", "seaborn", "numpy");
  }
  if (input.toggles.notebook?.enabled) {
    lines.push("jupyter", "ipykernel");
  }
  if (input.toggles.pytorch?.enabled) {
    lines.push("torch", "torchvision", "tqdm");
  }
  if (input.toggles.scraping?.enabled) {
    lines.push("requests", "beautifulsoup4", "lxml");
  }
  return lines.join("\n") + "\n";
}

function starterNotebook(name: string): string {
  return JSON.stringify(
    {
      cells: [
        {
          cell_type: "markdown",
          metadata: {},
          source: [`# ${name}\n`, "\nExploratory analysis notebook."],
        },
        {
          cell_type: "code",
          metadata: {},
          source: ["# Setup\nimport pandas as pd\nimport matplotlib.pyplot as plt\n"],
          outputs: [],
          execution_count: null,
        },
      ],
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: { name: "python", version: "3.11.0" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    1,
  );
}

function claudeMdDataML(input: ScaffoldInput): string {
  const sections: string[] = [];
  sections.push(`# ${input.projectName}`);
  sections.push("");
  if (input.description) {
    sections.push(input.description);
    sections.push("");
  }

  const stack = input.stackOverride || "Python, venv";
  sections.push(`**Stack:** ${stack}`);
  sections.push("");

  sections.push("## Quick Start");
  sections.push("");
  sections.push("```bash");
  sections.push("python -m venv venv");
  sections.push("source venv/bin/activate");
  sections.push("pip install -r requirements.txt");
  sections.push("```");
  sections.push("");

  if (input.toggles.notebook?.enabled) {
    sections.push("## Notebooks");
    sections.push("");
    sections.push(
      "Use Jupyter notebooks for exploration and prototyping. Keep notebooks in the `notebooks/` directory. When a notebook produces useful code, extract it into modules under `src/`.",
    );
    sections.push("");
  }

  if (input.toggles.pytorch?.enabled) {
    sections.push("## Training");
    sections.push("");
    sections.push(
      "PyTorch training scripts go in `src/`. Use `tqdm` for progress bars. Save checkpoints to `checkpoints/`. Log metrics to stdout in a parseable format.",
    );
    sections.push("");
  }

  if (input.toggles.scraping?.enabled) {
    sections.push("## Scraping");
    sections.push("");
    sections.push(
      "Use requests + BeautifulSoup for web scraping. Be respectful of rate limits. Cache responses locally during development. Store scraped data in `data/`.",
    );
    sections.push("");
  }

  sections.push("## Conventions");
  sections.push("");
  sections.push("- Use type hints throughout");
  sections.push("- Keep data in `data/`, never commit large datasets");
  sections.push("- Use `src/` for reusable modules");
  sections.push("- Document functions with docstrings");
  sections.push("- Use virtual environment, never install globally");
  sections.push("");

  return sections.join("\n");
}

// ── Notes ────────────────────────────────────────────────

function generateNotesFiles(input: ScaffoldInput): ScaffoldFile[] {
  const files: ScaffoldFile[] = [
    { path: ".gitignore", content: gitignoreGeneric() },
    { path: "CLAUDE.md", content: claudeMdNotes(input) },
    { path: "README.md", content: readmeMd(input) },
    { path: "notes/.gitkeep", content: "" },
    { path: "artifacts/.gitkeep", content: "" },
  ];
  return files;
}

function claudeMdNotes(input: ScaffoldInput): string {
  const sections: string[] = [];
  sections.push(`# ${input.projectName}`);
  sections.push("");
  if (input.description) {
    sections.push(input.description);
    sections.push("");
  }

  sections.push("## Structure");
  sections.push("");
  sections.push("- `notes/` — Markdown notes, ideas, and drafts");
  sections.push(
    "- `artifacts/` — Generated HTML artifacts for visual exploration",
  );
  sections.push("");

  sections.push("## Working Style");
  sections.push("");
  sections.push(
    "When working on ideas, always create markdown notes in the `notes/` directory. When exploring ideas visually or creating interactive demos, generate self-contained HTML files in the `artifacts/` directory.",
  );
  sections.push("");
  sections.push(
    "Artifacts should be single HTML files with inline CSS and JavaScript — no external dependencies. They should be viewable by opening the file directly in a browser.",
  );
  sections.push("");

  if (input.toggles["image-gen"]?.enabled) {
    const tool = input.toggles["image-gen"].value || "an image generation tool";
    sections.push("## Image Generation");
    sections.push("");
    sections.push(
      `Use ${tool} for generating images. Save generated images in \`artifacts/images/\` and reference them from notes.`,
    );
    sections.push("");
  }

  if (input.toggles.diagrams?.enabled) {
    sections.push("## Diagrams");
    sections.push("");
    sections.push(
      "Use Mermaid for technical diagrams. Embed diagrams in markdown notes using fenced code blocks with the `mermaid` language identifier. For complex diagrams, create standalone HTML artifacts that render the Mermaid diagrams.",
    );
    sections.push("");
  }

  sections.push("## Conventions");
  sections.push("");
  sections.push("- One idea per note file");
  sections.push("- Use descriptive filenames (not `note1.md`)");
  sections.push("- Cross-reference related notes with relative links");
  sections.push("- Date-stamp notes when chronology matters");
  sections.push("");

  return sections.join("\n");
}

// ── Research Agent ───────────────────────────────────────

function generateResearchAgentFiles(input: ScaffoldInput): ScaffoldFile[] {
  return [
    { path: ".gitignore", content: gitignoreGeneric() },
    { path: "CLAUDE.md", content: claudeMdResearchAgent(input) },
    { path: "README.md", content: readmeMd(input) },
    { path: "output/.gitkeep", content: "" },
  ];
}

function claudeMdResearchAgent(input: ScaffoldInput): string {
  const sections: string[] = [];
  sections.push(`# ${input.projectName}`);
  sections.push("");

  sections.push("## Agent Job");
  sections.push("");
  sections.push(
    input.description ||
      "This is a research agent. Describe what it should do in the task prompt.",
  );
  sections.push("");

  if (input.schedule) {
    sections.push(`**Schedule:** ${input.schedule}`);
    sections.push("");
  }

  sections.push("## Output");
  sections.push("");
  sections.push("Save all output to the `output/` directory. Use the format:");
  sections.push("");
  sections.push(
    "- `output/YYYY-MM-DD.md` — Daily reports (or per-run reports)",
  );
  sections.push("- `output/latest.md` — Always overwrite with the most recent run");
  sections.push("");
  sections.push(
    "Each report should have a clear date, summary, and detailed findings. Use markdown formatting with headers, bullet points, and links to sources.",
  );
  sections.push("");

  sections.push("## Conventions");
  sections.push("");
  sections.push("- Always include source links");
  sections.push("- Be concise but thorough");
  sections.push("- Note what changed since the last run when possible");
  sections.push("- If a source is unavailable, note it and continue");
  sections.push("");

  return sections.join("\n");
}

// ── Shared Helpers ───────────────────────────────────────

function readmeMd(input: ScaffoldInput): string {
  const lines = [`# ${input.projectName}`, ""];
  if (input.description) {
    lines.push(input.description, "");
  }
  const tmpl = templates.find((t) => t.id === input.templateId);
  if (tmpl && tmpl.id !== "blank") {
    lines.push(`Created with proq — ${tmpl.subtitle}`, "");
  }
  return lines.join("\n");
}

function gitignoreNode(): string {
  return `node_modules/
.next/
out/
dist/
build/
.env
.env.local
.env.*.local
*.tsbuildinfo
.DS_Store
`;
}

function gitignorePython(): string {
  return `venv/
__pycache__/
*.pyc
*.pyo
.ipynb_checkpoints/
data/
checkpoints/
*.egg-info/
dist/
build/
.env
.DS_Store
`;
}

function gitignoreGeneric(): string {
  return `.DS_Store
.env
*.log
`;
}

// ── Task Prompt Generators ───────────────────────────────

export function generateFirstTaskPrompt(input: ScaffoldInput): string {
  switch (input.templateId) {
    case "blank":
      return "Read CLAUDE.md and set up the initial project structure.";
    case "web-app":
      return webAppTaskPrompt(input);
    case "data-ml":
      return dataMLTaskPrompt(input);
    case "notes":
      return notesTaskPrompt(input);
    case "research-agent":
      return researchAgentTaskPrompt(input);
    default:
      return "Read CLAUDE.md and set up the initial project structure.";
  }
}

function webAppTaskPrompt(input: ScaffoldInput): string {
  const parts = [
    "Read CLAUDE.md for the full project spec, then initialize and set up this project:",
    "",
    "1. Run `npm install` to install all dependencies",
    "2. Set up the project structure (src/, components/, app/ etc.)",
    "3. Create the design system file with initial theme tokens, typography, and component conventions",
    "4. Build a basic landing page / home route to verify everything works",
  ];

  if (input.toggles.auth?.enabled) {
    parts.push(
      `5. Set up authentication (${input.toggles.auth.value || "as specified in CLAUDE.md"})`,
    );
  }
  if (input.toggles.database?.enabled) {
    parts.push(
      `${input.toggles.auth?.enabled ? "6" : "5"}. Set up the database layer (${input.toggles.database.value || "as specified in CLAUDE.md"})`,
    );
  }

  parts.push(
    "",
    "Make sure `npm run dev` starts successfully and the app renders in the browser.",
  );
  return parts.join("\n");
}

function dataMLTaskPrompt(input: ScaffoldInput): string {
  const parts = [
    "Read CLAUDE.md for the full project spec, then initialize and set up this project:",
    "",
    "1. Create a Python virtual environment (`python -m venv venv`)",
    "2. Install all dependencies from requirements.txt",
    "3. Set up the project structure (src/, data/, etc.)",
  ];

  if (input.toggles.notebook?.enabled) {
    parts.push(
      "4. Verify the Jupyter notebook runs and can import all dependencies",
    );
  }

  if (input.toggles.pytorch?.enabled) {
    parts.push(
      "5. Create a starter training script with a simple example model",
    );
  }

  parts.push("", "Make sure all imports work and the environment is ready.");
  return parts.join("\n");
}

function notesTaskPrompt(input: ScaffoldInput): string {
  const parts = [
    "Read CLAUDE.md for the full project spec. This is a notes and ideation workspace.",
    "",
    "1. Create an initial note in `notes/` that outlines the project goals and areas to explore",
  ];

  if (input.description) {
    parts.push(
      `2. Based on the project description, create a brainstorming note exploring the key themes and ideas`,
    );
    parts.push(
      `3. Create an HTML artifact in \`artifacts/\` that visually maps out the initial ideas`,
    );
  }

  return parts.join("\n");
}

function researchAgentTaskPrompt(input: ScaffoldInput): string {
  return [
    "Read CLAUDE.md for your job description. This is your first run.",
    "",
    "Execute your research task now and save the results to `output/`. Create both:",
    "- `output/latest.md` — the full report",
    `- \`output/${new Date().toISOString().slice(0, 10)}.md\` — dated copy`,
    "",
    "Be thorough and include source links.",
  ].join("\n");
}
