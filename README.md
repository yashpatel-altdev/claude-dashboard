# Claude Dashboard

A zero-dependency visual dashboard for your [Claude Code](https://claude.ai/code) setup. Reads `~/.claude/` and generates a beautiful, searchable HTML page showing everything in one place — agents, commands, skills, rules, hooks, memory, projects, and more.

No `npm install`. No build step. Just `node dashboard.js`.

---

## What It Shows

| Section | Description |
|---------|-------------|
| **Overview** | Stats summary — agent count, rule files, skills, hooks, sessions |
| **File Structure** | Annotated `~/.claude/` directory tree with clickable paths |
| **Settings** | Parsed `settings.json` + permissions allowlist |
| **Rules & Standards** | All coding rule files by category (common/typescript/python), rendered as Markdown |
| **Hooks** | PreToolUse, PostToolUse, Stop, and SessionEnd hooks with descriptions |
| **Agents** | All sub-agents with full documentation and file paths |
| **Commands** | All `/slash-commands` — plugin and user-defined, with docs |
| **Skills** | Expert knowledge modules from the plugin marketplace |
| **Memory** | Persistent memory files with type badges (user/feedback/project/reference) |
| **Projects** | Tracked projects with instinct and observation counts |

Every item shows its **exact file path** — click to copy to clipboard.

---

## Quick Start

**Option 1: Install to `~/.claude/` (recommended)**

```bash
git clone https://github.com/drippingfrog/claude-dashboard.git
cd claude-dashboard
bash install.sh
node ~/.claude/dashboard.js
```

**Option 2: Run directly from the repo**

```bash
git clone https://github.com/drippingfrog/claude-dashboard.git
node claude-dashboard/dashboard.js
```

**Option 3: One-line curl install**

```bash
curl -o ~/.claude/dashboard.js https://raw.githubusercontent.com/drippingfrog/claude-dashboard/main/dashboard.js
node ~/.claude/dashboard.js
```

---

## Usage

```bash
# Generate a snapshot and open in browser (default)
node ~/.claude/dashboard.js

# Start a live server — refresh anytime to see current state
node ~/.claude/dashboard.js --serve

# Live server on a custom port
node ~/.claude/dashboard.js --serve 8080
```

### Shell alias

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
alias claude-dash="node ~/.claude/dashboard.js"
```

---

## Requirements

- **Node.js 18+** (no npm install needed)
- **Claude Code** with `~/.claude/` directory
- **macOS** for auto-open in browser (Linux/Windows: copy the printed URL manually)

---

## How It Works

The script reads your `~/.claude/` directory and collects:

- `settings.json` / `settings.local.json` — configuration and permissions
- `rules/` — Markdown rule files by language category
- `plugins/cache/.../agents/` — agent definition files
- `plugins/cache/.../commands/` — slash command files
- `plugins/marketplaces/.../skills/` — skill modules
- `plugins/cache/.../hooks/hooks.json` — hook definitions
- `projects/.../memory/` — persistent memory files
- `homunculus/projects/` — per-project learned instincts

All data is embedded directly into a self-contained HTML file. No server required in snapshot mode — just open the file.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js built-in modules only (no dependencies) |
| Styling | [Tailwind CSS](https://tailwindcss.com) via CDN |
| Reactivity | [Alpine.js](https://alpinejs.dev) via CDN |
| Markdown | [Marked.js](https://marked.js.org) via CDN |

---

## License

MIT — see [LICENSE](./LICENSE)
