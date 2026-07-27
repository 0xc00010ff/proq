<p align="center">
  <img src="public/proq-badge.png" alt="proq" width="140" />
</p>

<h3 align="center">Serious vibe coding</h3>

<p align="center">
  <a href="#download">Descargar</a> &nbsp;&middot;&nbsp;
  <a href="#run-locally">Ejecutar Localmente</a> &nbsp;&middot;&nbsp;
  <a href="#docs">Docs</a>
</p>

---

#### Proq es un entorno de desarrollo agéntico para el "vibe coding" serio.

<img width="1769" height="1069" alt="Screenshot 2026-03-28 at 6 00 24 PM" src="https://github.com/user-attachments/assets/246a0a86-b701-475f-aadc-cd951cebe62d" />

Un gestor de tareas estilo kanban para instancias locales de Claude Code.

Crea una tarea → proq despliega un agente, le asigna un worktree aislado, observas al agente trabajar (o no), y previsualizas los cambios.

El objetivo es mantener la calidad y la claridad al hacer vibe coding. Historial automático, contextos frescos y enfocados, y operaciones paralelas. Es el doble de efectivo que una pantalla llena de terminales. 

Gratis, sin registro, solo local, y funciona con cualquier configuración de agente, MCPs y herramientas que ya utilices con Claude.

# Download

### App de macOS — empieza en 1 minuto

| Plataforma | Enlace |
|---|---|
| macOS (Apple Silicon) | [Descargar .dmg](https://github.com/0xc00010ff/proq/releases/latest/download/proq.dmg) |

Simplemente ábrelo y empieza a cocinar.

# Run Locally

Requiere **Node.js 18+** y el [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) en tu PATH.

```bash
git clone https://github.com/0xc00010ff/proq.git
cd proq
npm run setup
npm run dev
```

Abre [localhost:1337](http://localhost:1337). Añade proq como un proyecto. Crea una tarea y mira cómo la aplicación se actualiza a sí misma.

# Explore

- **Agentes paralelos** — cada tarea obtiene su propio git worktree y rama; múltiples agentes trabajan en la misma base de código sin conflictos.
- **Vista previa en vivo** — inicia y visualiza tu proyecto en vivo, permite que los agentes vean/usen tu aplicación.
- **Banco de trabajo del proyecto** — agente de formato libre, terminal y editor de código para ediciones rápidas.
- **API HTTP** — cada acción del tablero es un endpoint REST; cualquier cosa que pueda realizar peticiones HTTP puede gestionar tareas.
- **Servidor MCP** — gestiona proyectos y tareas desde cualquier agente o herramienta compatible con MCP.
- **Supervisor** — un agente que reside por encima de todos tus proyectos, puede conectarse a OpenClaw / agentes externos.
- **Personalización** — alterna entre kanban vs lista, chat elegante vs CLI bruto, modo claro/oscuro.
- **Auto-edición** — añade proq a su propia lista de proyectos, añade las funcionalidades que quieras.

# Docs

| Doc | Qué cubre |
|---|---|
| [Getting Started](docs/Getting-Started.md) | Instalación, creación de tareas, seguimiento de agentes, revisión |
| [Architecture](docs/Architecture.md) | Capa de datos, motor de despacho, rutas de API, ajustes |
| [Parallel Worktrees](docs/Parallel-Worktrees.md) | Ciclo de vida del worktree, ramas de vista previa, conflictos de fusión |
| [Self-Editing](docs/Self-Editing.md) | Desarrollando proq con proq |
| [Desktop App](desktop/README.md) | Configuración y empaquetado de la app de Electron |

## License

MIT

---

proq fue construido usando proq
