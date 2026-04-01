#!/usr/bin/env node
/**
 * Claude Setup Dashboard
 * Reads ~/.claude/ and generates a beautiful HTML dashboard
 * Run: node ~/.claude/dashboard.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const OUTPUT_FILE = path.join('/tmp', 'claude-dashboard.html');

// ─── Data Collection ──────────────────────────────────────────────────────────

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function readJSON(filePath) {
  const raw = readFile(filePath);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath).map(name => {
      const full = path.join(dirPath, name);
      return { name, full, isDir: fs.statSync(full).isDirectory() };
    });
  } catch { return []; }
}

// Parse YAML-style frontmatter from a markdown file.
// Returns { meta: { key: value, ... }, body: '...' }
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  }
  return { meta, body: match[2].trim() };
}

// Extract a one-sentence summary from markdown body (first non-heading paragraph).
function extractSummary(body) {
  const lines = body.split('\n');
  const para = lines.find(l => l.trim() && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('|') && !l.startsWith('-') && !l.startsWith('*') && !l.startsWith('`'));
  return (para || '').trim().replace(/\*\*/g, '').slice(0, 160);
}

function collectRules() {
  const rulesDir = path.join(CLAUDE_DIR, 'rules');
  const cats = listDir(rulesDir).filter(e => e.isDir);
  const result = {};
  for (const cat of cats) {
    result[cat.name] = {};
    const files = listDir(cat.full).filter(e => !e.isDir && e.name.endsWith('.md'));
    for (const f of files) {
      const raw = readFile(f.full) || '';
      const { meta, body } = parseFrontmatter(raw);
      const summary = meta.description || extractSummary(body);
      result[cat.name][f.name] = { content: raw, body, meta, summary, filePath: f.full };
    }
  }
  return result;
}

function collectAgents() {
  const agentsDir = path.join(CLAUDE_DIR, 'plugins', 'cache',
    'everything-claude-code', 'everything-claude-code', '1.8.0', 'agents');
  const files = listDir(agentsDir).filter(e => !e.isDir && e.name.endsWith('.md'));
  return files.map(f => {
    const raw = readFile(f.full) || '';
    const { meta, body } = parseFrontmatter(raw);
    const title = raw.match(/^#\s+(.+)$/m)?.[1] || f.name.replace('.md', '');
    const description = meta.description || extractSummary(body);
    return { name: f.name.replace('.md', ''), title, description, meta, body, content: raw, filePath: f.full };
  });
}

function collectCommands() {
  const cmdsDir = path.join(CLAUDE_DIR, 'plugins', 'cache',
    'everything-claude-code', 'everything-claude-code', '1.8.0', 'commands');
  const userCmdsDir = path.join(CLAUDE_DIR, 'commands');
  const pluginFiles = listDir(cmdsDir).filter(e => !e.isDir && e.name.endsWith('.md'));
  const userFiles = listDir(userCmdsDir).filter(e => !e.isDir && e.name.endsWith('.md'));
  return [...pluginFiles, ...userFiles].map(f => {
    const raw = readFile(f.full) || '';
    const { meta, body } = parseFrontmatter(raw);
    const title = raw.match(/^#\s+(.+)$/m)?.[1] || f.name.replace('.md', '');
    const description = meta.description || extractSummary(body);
    const isUser = f.full.startsWith(userCmdsDir);
    return { name: f.name.replace('.md', ''), title, description, meta, body, content: raw, filePath: f.full, isUser };
  });
}

function collectSkills() {
  const skillsBase = path.join(CLAUDE_DIR, 'plugins', 'marketplaces',
    'everything-claude-code', '.agents', 'skills');
  const userSkillsBase = path.join(CLAUDE_DIR, 'skills', 'learned');
  const skillDirs = listDir(skillsBase).filter(e => e.isDir);
  const userSkillDirs = listDir(userSkillsBase).filter(e => e.isDir);
  return [...skillDirs.map(d => ({ ...d, isUser: false })), ...userSkillDirs.map(d => ({ ...d, isUser: true }))].map(d => {
    const skillFile = path.join(d.full, 'SKILL.md');
    const raw = readFile(skillFile) || '';
    const { meta, body } = parseFrontmatter(raw);
    const title = raw.match(/^#\s+(.+)$/m)?.[1] || d.name;
    const description = meta.description || extractSummary(body);
    const origin = meta.origin || (d.isUser ? 'user' : 'ECC');
    return { name: d.name, title, description, origin, meta, body, content: raw, filePath: skillFile, isUser: d.isUser };
  });
}

function collectHooks() {
  const hooksFile = path.join(CLAUDE_DIR, 'plugins', 'cache',
    'everything-claude-code', 'everything-claude-code', '1.8.0', 'hooks', 'hooks.json');
  const data = readJSON(hooksFile);
  return data?.hooks || {};
}

function collectMemory() {
  const memDir = path.join(CLAUDE_DIR, 'projects', '-Users-drippingfrog', 'memory');
  const files = listDir(memDir).filter(e => !e.isDir && e.name.endsWith('.md'));
  const result = {};
  for (const f of files) {
    const raw = readFile(f.full) || '';
    const { meta, body } = parseFrontmatter(raw);
    result[f.name] = {
      content: raw,
      body,
      name: meta.name || f.name.replace('.md', ''),
      description: meta.description || '',
      type: meta.type || 'other',
      filePath: f.full,
    };
  }
  return result;
}

function collectFileStructure() {
  // Returns annotated directory tree of ~/.claude/ with explanations
  const ANNOTATIONS = {
    'settings.json':         'Global settings — plugins, hooks, effort level, model config',
    'settings.local.json':   'Local permission allowlist — which tools Claude can auto-run',
    'CLAUDE.md':             'Project-level instructions injected into every session',
    'rules/':                'Coding standards loaded automatically into all sessions',
    'rules/common/':         'Universal rules — apply to all languages and projects',
    'rules/typescript/':     'TypeScript-specific overrides for coding style and patterns',
    'rules/python/':         'Python-specific overrides (PEP 8, type hints, tooling)',
    'plugins/':              'Installed plugins and marketplace cache',
    'plugins/cache/':        'Downloaded plugin files (don\'t edit directly)',
    'plugins/marketplaces/': 'Plugin marketplace definitions and skill files',
    'commands/':             'Custom slash commands available as /command-name',
    'skills/':               'Learned skills saved from sessions',
    'skills/learned/':       'Instinct patterns extracted from your coding sessions',
    'memory/':               'Persistent memory files loaded into future sessions',
    'homunculus/':           'Per-project AI learning state (instincts, observations)',
    'homunculus/projects/':  'One folder per tracked project with learned patterns',
    'projects/':             'Session logs and per-project memory',
    'sessions/':             'Session metadata and conversation logs',
    'session-env/':          'Per-session environment snapshots',
    'backups/':              'Automatic backups of settings before changes',
    'cache/':                'Changelog and plugin metadata cache',
    'plan/':                 'Planning documents generated by /plan command',
    'debug/':                'Debug logs for troubleshooting',
  };

  function buildTree(dirPath, prefix = '', depth = 0) {
    if (depth > 3) return [];
    const SKIP = new Set(['node_modules', '.git', 'telemetry', 'metrics', 'paste-cache', 'shell-snapshots', 'ide', 'downloads', 'file-history', 'debug']);
    const entries = listDir(dirPath).filter(e => !SKIP.has(e.name));
    const result = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const key = e.isDir ? e.name + '/' : e.name;
      const annotation = ANNOTATIONS[key] || '';
      result.push({ path: e.full, name: e.name, isDir: e.isDir, depth, prefix, connector, annotation, key });
      if (e.isDir && depth < 2) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        result.push(...buildTree(e.full, childPrefix, depth + 1));
      }
    }
    return result;
  }

  return buildTree(CLAUDE_DIR);
}

function collectProjects() {
  const hDir = path.join(CLAUDE_DIR, 'homunculus', 'projects');
  const projects = listDir(hDir).filter(e => e.isDir);
  return projects.map(p => {
    const info = readJSON(path.join(p.full, 'project.json')) || { name: p.name, root: 'unknown' };

    // Personal instincts
    const personalDir = path.join(p.full, 'instincts', 'personal');
    const personalInstincts = listDir(personalDir)
      .filter(e => !e.isDir && e.name.endsWith('.md'))
      .map(e => {
        const raw = readFile(e.full) || '';
        const { meta, body } = parseFrontmatter(raw);
        return { name: meta.name || e.name.replace('.md', ''), summary: extractSummary(body), filePath: e.full };
      });

    // Inherited instincts
    const inheritedDir = path.join(p.full, 'instincts', 'inherited');
    const inheritedInstincts = listDir(inheritedDir)
      .filter(e => !e.isDir && e.name.endsWith('.md'))
      .map(e => e.name.replace('.md', ''));

    // Evolved agents/commands/skills
    const evolvedAgents   = listDir(path.join(p.full, 'evolved', 'agents')).filter(e => !e.isDir && e.name.endsWith('.md')).map(e => e.name.replace('.md', ''));
    const evolvedCommands = listDir(path.join(p.full, 'evolved', 'commands')).filter(e => !e.isDir && e.name.endsWith('.md')).map(e => e.name.replace('.md', ''));
    const evolvedSkills   = listDir(path.join(p.full, 'evolved', 'skills')).filter(e => !e.isDir && e.name.endsWith('.md')).map(e => e.name.replace('.md', ''));

    // Observations: count + last 3 tool names
    const obsRaw = readFile(path.join(p.full, 'observations.jsonl')) || '';
    const obsLines = obsRaw.split('\n').filter(Boolean);
    const recentObs = obsLines.slice(-3).map(line => {
      try {
        const j = JSON.parse(line);
        return j.tool || j.event || j.type || '?';
      } catch { return '?'; }
    }).filter(t => t !== '?');

    return {
      id: p.name,
      name: info.name || p.name,
      root: info.root || 'unknown',
      remote: info.remote || '',
      createdAt: info.created_at || '',
      lastSeen: info.last_seen || '',
      observationCount: obsLines.length,
      recentObs,
      personalInstincts,
      inheritedInstincts,
      evolvedAgents,
      evolvedCommands,
      evolvedSkills,
    };
  });
}

function collectSettings() {
  const global = readJSON(path.join(CLAUDE_DIR, 'settings.json')) || {};
  const raw    = readJSON(path.join(CLAUDE_DIR, 'settings.local.json')) || {};

  // Flatten nested permissions.allow into categorised lists
  const allAllowed = raw?.permissions?.allow || [];
  const allowedBash = allAllowed
    .filter(t => typeof t === 'string' && t.startsWith('Bash('))
    .map(t => t.replace(/^Bash\(/, '').replace(/\)$/, ''));
  const allowedMcp = allAllowed
    .filter(t => typeof t === 'string' && !t.startsWith('Bash('));

  return { global, allowedBash, allowedMcp };
}

// Extract key principles from rules/common/ as a live "philosophy" summary
function collectPhilosophy() {
  const files = ['coding-style.md', 'testing.md', 'security.md', 'performance.md', 'development-workflow.md'];
  const rulesDir = path.join(CLAUDE_DIR, 'rules', 'common');
  const principles = [];
  for (const fname of files) {
    const raw = readFile(path.join(rulesDir, fname));
    if (!raw) continue;
    const { body } = parseFrontmatter(raw);
    // Grab the first sentence under each ## heading
    const sections = body.split(/^##\s+/m).slice(1);
    for (const section of sections.slice(0, 2)) {
      const lines = section.split('\n');
      const heading = lines[0].trim();
      const summary = lines.slice(1).find(l => l.trim() && !l.startsWith('#') && !l.startsWith('`') && !l.startsWith('|') && !l.startsWith('-'));
      if (heading && summary) {
        principles.push({ rule: fname.replace('.md', ''), heading, summary: summary.trim().replace(/\*\*/g, '').slice(0, 120) });
      }
    }
  }
  return principles;
}

function collectStats() {
  const historyRaw = readFile(path.join(CLAUDE_DIR, 'history.jsonl'));
  const historyCount = historyRaw ? historyRaw.split('\n').filter(Boolean).length : 0;
  const sessions = listDir(path.join(CLAUDE_DIR, 'session-env')).filter(e => e.isDir);
  const backups = listDir(path.join(CLAUDE_DIR, 'backups')).filter(e => !e.isDir);
  const changelogRaw = readFile(path.join(CLAUDE_DIR, 'cache', 'changelog.json'));
  let version = 'unknown';
  try {
    const cl = JSON.parse(changelogRaw);
    version = cl.currentVersion || cl.version || Object.keys(cl)[0] || 'unknown';
  } catch {}
  return { historyCount, sessionCount: sessions.length, backupCount: backups.length, version };
}

// ─── HTML Generation ──────────────────────────────────────────────────────────

function escapeHTML(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJSON(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function generateHTML(data) {
  const {
    settings, rules, agents, commands, skills, hooks,
    memory, projects, stats, fileStructure, philosophy
  } = data;

  const ruleCategories = Object.keys(rules);
  const hookTypes = Object.keys(hooks);
  const totalRules = ruleCategories.reduce((sum, cat) => sum + Object.keys(rules[cat]).length, 0);
  const totalHooks = hookTypes.reduce((sum, type) => sum + hooks[type].length, 0);
  // Helper: extract content and path from rule entry (now objects with {content, filePath})
  const ruleContent = (cat, file) => rules[cat]?.[file]?.content || '';
  const rulePath = (cat, file) => rules[cat]?.[file]?.filePath || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Setup Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            claude: { 50:'#fdf6ee', 100:'#faecd8', 200:'#f4d4a8', 300:'#ecb571', 400:'#e28d3a', 500:'#cc6d22', 600:'#b05518', 700:'#8f4116', 800:'#753619', 900:'#61301a' },
          }
        }
      }
    }
  </script>
  <style>
    [x-cloak] { display: none !important; }
    .prose-custom h1 { font-size:1.4rem; font-weight:700; margin:1rem 0 .5rem; color:#1e293b; }
    .prose-custom h2 { font-size:1.15rem; font-weight:600; margin:.8rem 0 .4rem; color:#334155; border-bottom:1px solid #e2e8f0; padding-bottom:.25rem; }
    .prose-custom h3 { font-size:1rem; font-weight:600; margin:.6rem 0 .3rem; color:#475569; }
    .prose-custom p { margin:.4rem 0; line-height:1.6; color:#475569; font-size:.875rem; }
    .prose-custom code { background:#f1f5f9; padding:.1rem .3rem; border-radius:.25rem; font-size:.8rem; color:#e25822; }
    .prose-custom pre { background:#1e293b; color:#e2e8f0; padding:.75rem 1rem; border-radius:.5rem; overflow-x:auto; margin:.5rem 0; font-size:.8rem; }
    .prose-custom pre code { background:none; color:inherit; padding:0; }
    .prose-custom ul { list-style:disc; padding-left:1.25rem; color:#475569; font-size:.875rem; }
    .prose-custom li { margin:.15rem 0; }
    .prose-custom a { color:#cc6d22; text-decoration:underline; }
    .prose-custom table { width:100%; border-collapse:collapse; font-size:.8rem; margin:.5rem 0; }
    .prose-custom th { background:#f8fafc; font-weight:600; padding:.4rem .6rem; border:1px solid #e2e8f0; text-align:left; }
    .prose-custom td { padding:.4rem .6rem; border:1px solid #e2e8f0; }
    .badge { display:inline-flex; align-items:center; padding:.1rem .4rem; border-radius:9999px; font-size:.7rem; font-weight:600; }
    body { background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .sidebar-item { transition: all .15s; }
    .sidebar-item:hover { background: rgba(204,109,34,.08); color: #cc6d22; }
    .sidebar-item.active { background: rgba(204,109,34,.12); color: #cc6d22; font-weight: 600; border-left: 3px solid #cc6d22; }
    .card { background: white; border-radius: .75rem; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .stat-card { background: white; border-radius: .75rem; border: 1px solid #e2e8f0; padding: 1.25rem; }
    .tag { display:inline-block; padding:.1rem .5rem; border-radius:9999px; font-size:.7rem; font-weight:600; }
    .path-pill { display:inline-flex; align-items:center; gap:.35rem; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:.375rem; padding:.25rem .6rem; font-size:.72rem; font-family:monospace; color:#475569; cursor:pointer; transition:background .1s; max-width:100%; overflow:hidden; }
    .path-pill:hover { background:#e2e8f0; }
    .path-pill .path-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tree-line { font-family: monospace; font-size: .78rem; line-height: 1.7; white-space: nowrap; }
    .tree-annotation { font-family: -apple-system, sans-serif; font-size: .72rem; color: #94a3b8; margin-left:.5rem; }
    .section-desc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius:.5rem; padding:.75rem 1rem; margin-bottom:1.25rem; }
    .section-desc p { font-size:.82rem; color:#475569; line-height:1.5; margin:0; }
    .section-desc strong { color:#334155; }
  </style>
</head>
<body class="min-h-screen">

<script>
  // ─── Embedded Data ─────────────────────────────────────────────────────────
  const DATA = ${escapeJSON({ settings, rules, agents, commands, skills, hooks, memory, projects, stats })};

  // ─── Alpine App ────────────────────────────────────────────────────────────
  function app() {
    return {
      activeSection: 'overview',
      activeRuleCat: ${escapeJSON(ruleCategories[0] || 'common')},
      activeRuleFile: null,
      activeAgent: null,
      activeCommand: null,
      activeSkill: null,
      activeMemoryFile: null,
      expandedHook: null,
      search: '',

      sections: [
        { id:'overview',   icon:'⚡', label:'Overview' },
        { id:'structure',  icon:'🗂️', label:'File Structure' },
        { id:'settings',   icon:'⚙️', label:'Settings' },
        { id:'rules',      icon:'📋', label:'Rules & Standards' },
        { id:'hooks',      icon:'🪝', label:'Hooks' },
        { id:'agents',     icon:'🤖', label:'Agents' },
        { id:'commands',   icon:'💬', label:'Commands' },
        { id:'skills',     icon:'🎯', label:'Skills' },
        { id:'memory',     icon:'🧠', label:'Memory' },
        { id:'projects',   icon:'📁', label:'Projects' },
      ],

      get filteredAgents() {
        const q = this.search.toLowerCase();
        if (!q) return DATA.agents;
        return DATA.agents.filter(a => a.name.includes(q) || a.description.toLowerCase().includes(q));
      },

      get filteredCommands() {
        const q = this.search.toLowerCase();
        if (!q) return DATA.commands;
        return DATA.commands.filter(c => c.name.includes(q) || c.description.toLowerCase().includes(q));
      },

      get filteredSkills() {
        const q = this.search.toLowerCase();
        if (!q) return DATA.skills;
        return DATA.skills.filter(s => s.name.includes(q) || s.description.toLowerCase().includes(q));
      },

      renderMarkdown(md) {
        try { return marked.parse(md || ''); } catch { return md || ''; }
      },

      formatDate(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
      },

      nav(section) {
        this.activeSection = section;
        this.search = '';
      },

      hookColor(type) {
        const colors = { PreToolUse:'bg-blue-100 text-blue-800', PostToolUse:'bg-green-100 text-green-800', Stop:'bg-red-100 text-red-800', SessionEnd:'bg-purple-100 text-purple-800' };
        return colors[type] || 'bg-gray-100 text-gray-800';
      },

      ruleCatColor(cat) {
        const colors = { common:'bg-claude-100 text-claude-700', typescript:'bg-blue-100 text-blue-700', python:'bg-yellow-100 text-yellow-800' };
        return colors[cat] || 'bg-gray-100 text-gray-700';
      },

      memoryTypeColor(content) {
        const m = content.match(/^type:\\s*(\\w+)/m);
        const type = m?.[1] || 'other';
        const colors = { user:'bg-blue-100 text-blue-700', feedback:'bg-amber-100 text-amber-700', project:'bg-green-100 text-green-700', reference:'bg-purple-100 text-purple-700' };
        return colors[type] || 'bg-gray-100 text-gray-600';
      },

      memoryTypeName(content) {
        const m = content.match(/^type:\\s*(\\w+)/m);
        return m?.[1] || 'other';
      },

      memoryTitle(content) {
        const m = content.match(/^name:\\s*(.+)$/m);
        return m?.[1] || 'Memory';
      },

      memoryBody(content) {
        return content.replace(/^---[\\s\\S]*?---\\n*/m, '').trim();
      },

      copyPath(p) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(p).then(() => {
            this.copied = p;
            setTimeout(() => { this.copied = null; }, 1500);
          });
        }
      },

      copied: null,

      openInFinder(p) {
        // Can't open in Finder from browser, but we show the path for manual use
      }
    };
  }
</script>

<div x-data="app()" class="flex min-h-screen">

  <!-- Sidebar -->
  <aside class="w-56 bg-white border-r border-slate-200 flex flex-col fixed h-screen overflow-y-auto z-10">
    <!-- Logo -->
    <div class="px-4 py-5 border-b border-slate-200">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-claude-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">C</div>
        <div>
          <div class="font-bold text-slate-800 text-sm">Claude Setup</div>
          <div class="text-xs text-slate-400">v${escapeHTML(stats.version || '?')}</div>
        </div>
      </div>
    </div>

    <!-- Nav -->
    <nav class="flex-1 px-2 py-3 space-y-0.5">
      <template x-for="s in sections" :key="s.id">
        <button
          @click="nav(s.id)"
          :class="['sidebar-item w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-600 cursor-pointer', activeSection === s.id ? 'active' : '']"
        >
          <span x-text="s.icon" class="w-4 text-center"></span>
          <span x-text="s.label"></span>
        </button>
      </template>
    </nav>

    <!-- Footer -->
    <div class="px-4 py-3 border-t border-slate-200 text-xs text-slate-400">
      Generated <span class="text-slate-500 font-medium">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="ml-56 flex-1 p-6 overflow-y-auto">

    <!-- ── OVERVIEW ── -->
    <div x-show="activeSection === 'overview'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Claude Setup Overview</h1>
      <p class="text-slate-500 text-sm mb-6">Your complete Claude Code configuration at a glance</p>

      <!-- Stat Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        ${[
          { label: 'Rules', value: totalRules, icon: '📋', color: 'text-claude-600' },
          { label: 'Agents', value: agents.length, icon: '🤖', color: 'text-blue-600' },
          { label: 'Commands', value: commands.length, icon: '💬', color: 'text-indigo-600' },
          { label: 'Skills', value: skills.length, icon: '🎯', color: 'text-emerald-600' },
          { label: 'Hooks', value: totalHooks, icon: '🪝', color: 'text-amber-600' },
          { label: 'Projects', value: projects.length, icon: '📁', color: 'text-purple-600' },
          { label: 'Sessions', value: stats.sessionCount, icon: '🔄', color: 'text-rose-600' },
          { label: 'History', value: stats.historyCount, icon: '📜', color: 'text-slate-600' },
        ].map(({ label, value, icon, color }) => `
        <div class="stat-card">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xl">${icon}</span>
            <span class="text-xs font-medium text-slate-400 uppercase tracking-wide">${label}</span>
          </div>
          <div class="${color} text-3xl font-bold">${value}</div>
        </div>`).join('')}
      </div>

      <!-- Quick Info Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

        <!-- Plugin -->
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-3 flex items-center gap-2">🔌 Installed Plugin</h2>
          <div class="bg-slate-50 rounded-lg p-3">
            <div class="font-semibold text-slate-800">everything-claude-code</div>
            <div class="text-sm text-slate-500">v1.8.0 · affaan-m/everything-claude-code</div>
            <div class="mt-2 flex gap-2 flex-wrap">
              <span class="tag bg-green-100 text-green-700">✓ Active</span>
              <span class="tag bg-slate-100 text-slate-600">Marketplace</span>
            </div>
          </div>
        </div>

        <!-- Settings Summary -->
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-3 flex items-center gap-2">⚙️ Core Settings</h2>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-slate-500">Effort Level</span><span class="font-medium text-slate-700 capitalize">${escapeHTML(settings.global?.effortLevel || 'medium')}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Extended Thinking</span><span class="font-medium text-green-600">Enabled (31,999 tokens)</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Version</span><span class="font-medium text-slate-700">v${escapeHTML(stats.version)}</span></div>
            <div class="flex justify-between"><span class="text-slate-500">Backups</span><span class="font-medium text-slate-700">${stats.backupCount} saved</span></div>
          </div>
        </div>

        <!-- Rule Categories -->
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-3">📋 Rule Categories</h2>
          <div class="space-y-2">
            ${ruleCategories.map(cat => `
            <div class="flex items-center justify-between">
              <span class="capitalize text-sm text-slate-700">${escapeHTML(cat)}</span>
              <div class="flex items-center gap-2">
                <div class="h-2 bg-claude-200 rounded-full" style="width:${Math.min(Object.keys(rules[cat]).length * 18, 100)}px"></div>
                <span class="text-xs text-slate-500">${Object.keys(rules[cat]).length} files</span>
              </div>
            </div>`).join('')}
          </div>
        </div>

        <!-- Development Philosophy — live from rules/common/ -->
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-1">🎯 Active Coding Standards</h2>
          <p class="text-xs text-slate-400 mb-3">Live — extracted from your <code>rules/common/</code> files</p>
          <div class="space-y-2 text-sm">
            ${philosophy.slice(0, 8).map(p => `
            <div class="flex gap-2 items-start">
              <span class="tag bg-slate-100 text-slate-500 shrink-0 mt-0.5">${escapeHTML(p.rule)}</span>
              <div><span class="font-medium text-slate-700">${escapeHTML(p.heading)}</span> — <span class="text-slate-500">${escapeHTML(p.summary)}</span></div>
            </div>`).join('')}
            ${philosophy.length === 0 ? '<p class="text-slate-400 text-xs">No rules found in ~/.claude/rules/common/</p>' : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- ── FILE STRUCTURE ── -->
    <div x-show="activeSection === 'structure'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">File Structure</h1>
      <p class="text-slate-500 text-sm mb-4">Every file and folder in your <code class="text-xs bg-slate-100 px-1 py-0.5 rounded">~/.claude/</code> directory — click any path to copy it</p>

      <div class="section-desc mb-4">
        <p><strong>~/.claude/</strong> is Claude Code's home directory. It holds your global settings, rules that shape Claude's behavior, installed plugins, per-project memory, session logs, and the learned instinct system. Edit files directly in any text editor — changes take effect in the next Claude session.</p>
      </div>

      <div class="card p-5 overflow-x-auto">
        <div class="mb-2 flex items-center gap-2">
          <span class="path-pill" @click="copyPath('${escapeHTML(CLAUDE_DIR)}')">
            <span>📁</span>
            <span class="path-text">${escapeHTML(CLAUDE_DIR)}</span>
            <span x-show="copied === '${escapeHTML(CLAUDE_DIR)}'" class="text-green-500">✓</span>
            <span x-show="copied !== '${escapeHTML(CLAUDE_DIR)}'" class="opacity-40">⎘</span>
          </span>
        </div>
        <div class="space-y-0.5">
          ${fileStructure.map(node => `
          <div class="tree-line flex items-baseline gap-1 group">
            <span class="text-slate-300 select-none">${escapeHTML(node.prefix)}${escapeHTML(node.connector)}</span>
            <span
              class="cursor-pointer hover:text-claude-600 transition-colors ${node.isDir ? 'text-blue-600 font-medium' : 'text-slate-700'}"
              @click="copyPath('${escapeHTML(node.path)}')"
              title="Click to copy path"
            >${escapeHTML(node.name)}${node.isDir ? '/' : ''}<span x-show="copied === '${escapeHTML(node.path)}'" class="text-green-500 ml-1 text-xs">✓ copied</span></span>
            ${node.annotation ? `<span class="tree-annotation hidden group-hover:inline">— ${escapeHTML(node.annotation)}</span>` : ''}
          </div>`).join('')}
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        ${[
          ['rules/', 'Rules & Standards', 'Markdown files loaded into every Claude session as instructions. Edit to change how Claude writes code.', CLAUDE_DIR + '/rules/'],
          ['commands/', 'Custom Commands', 'Add .md files here to create /slash-commands available in any Claude session.', CLAUDE_DIR + '/commands/'],
          ['memory/', 'Memory Files', 'Persistent context that carries across sessions. Claude reads these at session start.', CLAUDE_DIR + '/projects/-Users-drippingfrog/memory/'],
          ['plugins/', 'Plugins', 'everything-claude-code plugin lives here with all agents, skills, and hooks.', CLAUDE_DIR + '/plugins/'],
        ].map(([label, title, desc, p]) => `
        <div class="card p-4 cursor-pointer hover:border-claude-300 transition-colors" @click="copyPath('${escapeHTML(p)}')">
          <div class="flex items-start justify-between gap-2 mb-1">
            <span class="font-semibold text-slate-700 text-sm">${escapeHTML(title)}</span>
            <span x-show="copied === '${escapeHTML(p)}'" class="tag bg-green-100 text-green-700">✓ copied</span>
          </div>
          <p class="text-xs text-slate-500 mb-2">${escapeHTML(desc)}</p>
          <code class="text-xs text-slate-400 bg-slate-50 px-2 py-1 rounded block truncate">${escapeHTML(p)}</code>
        </div>`).join('')}
      </div>
    </div>

    <!-- ── SETTINGS ── -->
    <div x-show="activeSection === 'settings'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Settings</h1>
      <p class="text-slate-500 text-sm mb-3">Global and local Claude Code configuration</p>
      <div class="section-desc mb-5">
        <p><strong>settings.json</strong> controls which plugins are enabled, your effort level, MCP server connections, and global hooks. <strong>settings.local.json</strong> is an allowlist of tools Claude can invoke without asking permission — edit carefully.</p>
        <p class="mt-1">📍 Edit at: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(CLAUDE_DIR + '/settings.json')}')">~/.claude/settings.json</span></p>
      </div>

      <div class="grid grid-cols-1 gap-4">
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-3">settings.json — Global</h2>
          <pre class="bg-slate-900 text-green-300 p-4 rounded-lg text-xs overflow-x-auto">${escapeHTML(JSON.stringify(settings.global, null, 2))}</pre>
        </div>
        <div class="card p-5">
          <h2 class="font-semibold text-slate-700 mb-1">settings.local.json — Auto-approved Permissions</h2>
          <p class="text-xs text-slate-400 mb-4">These tools run without asking for your approval</p>
          ${settings.allowedBash.length + settings.allowedMcp.length === 0
            ? '<p class="text-sm text-slate-400">No permissions configured</p>'
            : `<div class="space-y-4">
            <div>
              <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Bash Commands (${settings.allowedBash.length})</div>
              <div class="space-y-1">
                ${settings.allowedBash.map(cmd => `
                <div class="flex items-start gap-2 text-xs">
                  <span class="tag bg-amber-50 text-amber-700 shrink-0 mt-0.5">bash</span>
                  <code class="text-slate-600 break-all">${escapeHTML(cmd)}</code>
                </div>`).join('')}
              </div>
            </div>
            <div>
              <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">MCP Tools (${settings.allowedMcp.length})</div>
              <div class="flex flex-wrap gap-1">
                ${settings.allowedMcp.map(t => `<span class="tag bg-blue-50 text-blue-700">${escapeHTML(t)}</span>`).join('')}
              </div>
            </div>
          </div>`}
        </div>
      </div>
    </div>

    <!-- ── RULES ── -->
    <div x-show="activeSection === 'rules'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Rules & Standards</h1>
      <p class="text-slate-500 text-sm mb-3">Coding guidelines automatically loaded into every Claude session</p>

      <div class="section-desc mb-4">
        <p><strong>Rules</strong> are Markdown files in <code class="text-xs bg-white border border-slate-200 px-1 rounded">~/.claude/rules/</code> that Claude reads as instructions at the start of every session. They define how Claude writes code — immutability, error handling, test coverage, commit style, and more. Organized into three categories: <strong>common</strong> (all languages), <strong>typescript</strong>, and <strong>python</strong>. Edit any file to change Claude's behavior globally.</p>
      </div>

      <!-- Category Tabs -->
      <div class="flex gap-2 mb-5 flex-wrap">
        ${ruleCategories.map(cat => `
        <button
          @click="activeRuleCat = '${cat}'; activeRuleFile = null"
          :class="['px-3 py-1.5 rounded-lg text-sm font-medium transition-all', activeRuleCat === '${cat}' ? 'bg-claude-500 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-claude-300']"
        >${escapeHTML(cat)} <span class="opacity-70 font-normal">(${Object.keys(rules[cat]).length})</span></button>`).join('')}
      </div>

      <div class="flex gap-4">
        <!-- File List -->
        <div class="w-52 shrink-0 space-y-1">
          ${ruleCategories.map(cat => `
          <template x-if="activeRuleCat === '${cat}'">
            <div class="space-y-1">
              ${Object.keys(rules[cat]).map(file => `
              <button
                @click="activeRuleFile = '${cat}::${file}'"
                :class="['w-full text-left px-3 py-2 rounded-lg text-sm transition-all', activeRuleFile === '${cat}::${file}' ? 'bg-claude-100 text-claude-700 font-medium' : 'text-slate-600 hover:bg-slate-100']"
              >${escapeHTML(file.replace('.md', ''))}</button>`).join('')}
            </div>
          </template>`).join('')}
        </div>

        <!-- Content -->
        <div class="flex-1 card p-5 min-h-64">
          <div x-show="!activeRuleFile" class="flex items-center justify-center h-40 text-slate-400 text-sm">
            ← Select a rule file to view
          </div>
          ${ruleCategories.map(cat =>
            Object.entries(rules[cat]).map(([file, entry]) => `
          <div x-show="activeRuleFile === '${cat}::${file}'">
            <div class="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
              <span class="path-pill" @click="copyPath('${escapeHTML(entry.filePath)}')">
                <span class="path-text">${escapeHTML(entry.filePath)}</span>
                <span x-show="copied === '${escapeHTML(entry.filePath)}'" class="text-green-500">✓</span>
                <span x-show="copied !== '${escapeHTML(entry.filePath)}'" class="opacity-40">⎘</span>
              </span>
            </div>
            <div class="prose-custom" x-html="renderMarkdown(${escapeJSON(entry.content)})"></div>
          </div>`).join('')
          ).join('')}
        </div>
      </div>
    </div>

    <!-- ── HOOKS ── -->
    <div x-show="activeSection === 'hooks'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Hooks</h1>
      <p class="text-slate-500 text-sm mb-3">Automation that runs before/after tool use and session events</p>
      <div class="section-desc mb-5">
        <p><strong>Hooks</strong> are shell commands that run automatically in response to Claude's actions — like a middleware layer. <strong>PreToolUse</strong> runs before a tool executes (can block it), <strong>PostToolUse</strong> runs after (can auto-format code), <strong>Stop</strong> runs at the end of each response (cost tracking, session saving), and <strong>SessionEnd</strong> runs when the session closes. Your hooks come from the <em>everything-claude-code</em> plugin.</p>
        <p class="mt-1">📍 Config at: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'plugins', 'cache', 'everything-claude-code', 'everything-claude-code', '1.8.0', 'hooks', 'hooks.json'))}')">~/.claude/plugins/cache/.../hooks/hooks.json</span></p>
      </div>

      <div class="space-y-4">
        ${hookTypes.map(type => `
        <div class="card overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <span class="tag ${type === 'PreToolUse' ? 'bg-blue-100 text-blue-700' : type === 'PostToolUse' ? 'bg-green-100 text-green-700' : type === 'Stop' ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}">${escapeHTML(type)}</span>
            <span class="text-sm text-slate-500">${hooks[type].length} hook${hooks[type].length !== 1 ? 's' : ''}</span>
          </div>
          <div class="divide-y divide-slate-100">
            ${hooks[type].map((hook, i) => `
            <div class="px-5 py-3">
              <div class="flex items-start gap-3">
                <span class="tag bg-slate-100 text-slate-600 mt-0.5 shrink-0">${escapeHTML(hook.matcher || '*')}</span>
                <div class="flex-1">
                  <div class="text-sm font-medium text-slate-700">${escapeHTML(hook.description || 'Unnamed hook')}</div>
                  ${hook.hooks?.[0]?.command ? `<code class="text-xs text-slate-400 mt-1 block truncate">${escapeHTML(hook.hooks[0].command.replace(/\\/g, '').replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '~/.claude/plugins/...'))}</code>` : ''}
                </div>
                ${hook.hooks?.[0]?.async ? '<span class="tag bg-amber-100 text-amber-700 shrink-0">async</span>' : ''}
              </div>
            </div>`).join('')}
          </div>
        </div>`).join('')}
      </div>
    </div>

    <!-- ── AGENTS ── -->
    <div x-show="activeSection === 'agents'">
      <div class="flex items-center justify-between mb-1">
        <h1 class="text-2xl font-bold text-slate-800">Agents</h1>
        <span class="tag bg-blue-100 text-blue-700">${agents.length} total</span>
      </div>
      <p class="text-slate-500 text-sm mb-3">Specialized sub-agents invoked for specific engineering tasks</p>
      <div class="section-desc mb-4">
        <p><strong>Agents</strong> are autonomous sub-processes that Claude spins up to handle specialized work. Each agent has a defined role, a curated toolset, and its own system prompt. Claude orchestrates them automatically based on context — e.g., after writing code, the <em>code-reviewer</em> agent runs; when a build fails, <em>build-error-resolver</em> kicks in. Agents come from the <em>everything-claude-code</em> plugin and run in isolated contexts so they don't pollute the main conversation.</p>
        <p class="mt-1">📍 Files at: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'plugins', 'cache', 'everything-claude-code', 'everything-claude-code', '1.8.0', 'agents'))}')">~/.claude/plugins/cache/.../agents/</span></p>
      </div>
      <input x-model="search" placeholder="Search agents..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-4 outline-none focus:border-claude-400" />

      <div class="flex gap-4">
        <div class="w-56 shrink-0 space-y-1 max-h-[65vh] overflow-y-auto">
          <template x-for="a in filteredAgents" :key="a.name">
            <button
              @click="activeAgent = a.name"
              :class="['w-full text-left px-3 py-2 rounded-lg transition-all', activeAgent === a.name ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100']"
            >
              <div class="text-sm font-medium" x-text="a.name"></div>
              <div class="text-xs text-slate-400 truncate mt-0.5" x-text="a.description" style="max-width:180px"></div>
            </button>
          </template>
        </div>
        <div class="flex-1 card p-5 min-h-64 overflow-y-auto max-h-[75vh]">
          <div x-show="!activeAgent" class="flex items-center justify-center h-40 text-slate-400 text-sm">← Select an agent</div>
          ${agents.map(a => `
          <div x-show="activeAgent === '${a.name}'">
            <div class="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4">
              <div class="font-semibold text-blue-800 mb-1">${escapeHTML(a.title)}</div>
              <p class="text-sm text-blue-700">${escapeHTML(a.description)}</p>
            </div>
            <div class="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
              <span class="path-pill" @click="copyPath('${escapeHTML(a.filePath)}')">
                <span class="path-text">${escapeHTML(a.filePath)}</span>
                <span x-show="copied === '${escapeHTML(a.filePath)}'" class="text-green-500">✓</span>
                <span x-show="copied !== '${escapeHTML(a.filePath)}'" class="opacity-40">⎘</span>
              </span>
            </div>
            <div class="prose-custom" x-html="renderMarkdown(${escapeJSON(a.body || a.content)})"></div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- ── COMMANDS ── -->
    <div x-show="activeSection === 'commands'">
      <div class="flex items-center justify-between mb-1">
        <h1 class="text-2xl font-bold text-slate-800">Commands</h1>
        <span class="tag bg-indigo-100 text-indigo-700">${commands.length} total</span>
      </div>
      <p class="text-slate-500 text-sm mb-3">Slash commands available in every Claude Code session</p>
      <div class="section-desc mb-4">
        <p><strong>Commands</strong> are Markdown files that become <code class="text-xs bg-white border border-slate-200 px-1 rounded">/slash-commands</code>. When you type <code class="text-xs bg-white border border-slate-200 px-1 rounded">/command-name</code>, Claude reads the Markdown as the prompt. Plugin commands come from <em>everything-claude-code</em>; you can create your own by dropping a <code class="text-xs bg-white border border-slate-200 px-1 rounded">.md</code> file in <code class="text-xs bg-white border border-slate-200 px-1 rounded">~/.claude/commands/</code> (shown with a <em>user</em> badge below).</p>
        <p class="mt-1">📍 Your commands: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'commands'))}')">~/.claude/commands/</span> · Plugin commands: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'plugins', 'cache', 'everything-claude-code', 'everything-claude-code', '1.8.0', 'commands'))}')">~/.claude/plugins/.../commands/</span></p>
      </div>
      <input x-model="search" placeholder="Search commands..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-4 outline-none focus:border-claude-400" />

      <div class="flex gap-4">
        <div class="w-56 shrink-0 space-y-1 max-h-[65vh] overflow-y-auto">
          <template x-for="c in filteredCommands" :key="c.name">
            <button
              @click="activeCommand = c.name"
              :class="['w-full text-left px-3 py-2 rounded-lg transition-all', activeCommand === c.name ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100']"
            >
              <div class="text-sm font-medium"><span class="opacity-50">/</span><span x-text="c.name"></span><span x-show="c.isUser" class="tag bg-emerald-100 text-emerald-600 ml-1 text-xs">user</span></div>
              <div class="text-xs text-slate-400 truncate mt-0.5" x-text="c.description" style="max-width:180px"></div>
            </button>
          </template>
        </div>
        <div class="flex-1 card p-5 min-h-64 overflow-y-auto max-h-[75vh]">
          <div x-show="!activeCommand" class="flex items-center justify-center h-40 text-slate-400 text-sm">← Select a command</div>
          ${commands.map(c => `
          <div x-show="activeCommand === '${c.name}'">
            <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3 mb-4">
              <div class="font-semibold text-indigo-800 mb-1">/<span>${escapeHTML(c.name)}</span></div>
              <p class="text-sm text-indigo-700">${escapeHTML(c.description || 'No description available')}</p>
            </div>
            <div class="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100 flex-wrap">
              <span class="path-pill" @click="copyPath('${escapeHTML(c.filePath)}')">
                <span class="path-text">${escapeHTML(c.filePath)}</span>
                <span x-show="copied === '${escapeHTML(c.filePath)}'" class="text-green-500">✓</span>
                <span x-show="copied !== '${escapeHTML(c.filePath)}'" class="opacity-40">⎘</span>
              </span>
              ${c.isUser ? '<span class="tag bg-emerald-100 text-emerald-700">user-defined</span>' : '<span class="tag bg-slate-100 text-slate-500">plugin</span>'}
            </div>
            <div class="prose-custom" x-html="renderMarkdown(${escapeJSON(c.body || c.content)})"></div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- ── SKILLS ── -->
    <div x-show="activeSection === 'skills'">
      <div class="flex items-center justify-between mb-1">
        <h1 class="text-2xl font-bold text-slate-800">Skills</h1>
        <span class="tag bg-emerald-100 text-emerald-700">${skills.length} total</span>
      </div>
      <p class="text-slate-500 text-sm mb-3">Reusable behavior patterns that load when triggered by context</p>
      <div class="section-desc mb-4">
        <p><strong>Skills</strong> are expert knowledge modules — each is a <code class="text-xs bg-white border border-slate-200 px-1 rounded">SKILL.md</code> file containing a specialized system prompt that Claude loads when you invoke that skill. Think of them as "modes" that make Claude an expert in a specific domain (e.g. <em>tdd-workflow</em> enforces test-first development, <em>deep-research</em> activates multi-source web research, <em>security-review</em> enables vulnerability scanning). Skills come from the <em>everything-claude-code</em> marketplace. Your custom learned skills appear with a <em>user</em> badge.</p>
        <p class="mt-1">📍 Plugin skills: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'plugins', 'marketplaces', 'everything-claude-code', '.agents', 'skills'))}')">~/.claude/plugins/marketplaces/.../skills/</span> · Learned: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'skills', 'learned'))}')">~/.claude/skills/learned/</span></p>
      </div>
      <input x-model="search" placeholder="Search skills..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-4 outline-none focus:border-claude-400" />

      <div class="flex gap-4">
        <div class="w-56 shrink-0 space-y-1 max-h-[65vh] overflow-y-auto">
          <template x-for="s in filteredSkills" :key="s.name">
            <button
              @click="activeSkill = s.name"
              :class="['w-full text-left px-3 py-2 rounded-lg transition-all', activeSkill === s.name ? 'bg-emerald-100 text-emerald-700' : 'text-slate-600 hover:bg-slate-100']"
            >
              <div class="text-sm font-medium flex items-center gap-1"><span x-text="s.name"></span><span x-show="s.isUser" class="tag bg-blue-100 text-blue-600 text-xs">user</span></div>
              <div class="text-xs text-slate-400 truncate mt-0.5" x-text="s.description" style="max-width:180px"></div>
            </button>
          </template>
        </div>
        <div class="flex-1 card p-5 min-h-64 overflow-y-auto max-h-[75vh]">
          <div x-show="!activeSkill" class="flex items-center justify-center h-40 text-slate-400 text-sm">← Select a skill</div>
          ${skills.map(s => `
          <div x-show="activeSkill === '${s.name}'">
            <div class="bg-emerald-50 border border-emerald-100 rounded-lg p-3 mb-4">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-emerald-800">${escapeHTML(s.title)}</span>
                <span class="tag bg-emerald-100 text-emerald-700">${escapeHTML(s.origin)}</span>
                ${s.isUser ? '<span class="tag bg-blue-100 text-blue-700">user-learned</span>' : ''}
              </div>
              <p class="text-sm text-emerald-700">${escapeHTML(s.description || 'No description available')}</p>
            </div>
            <div class="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100 flex-wrap">
              <span class="path-pill" @click="copyPath('${escapeHTML(s.filePath)}')">
                <span class="path-text">${escapeHTML(s.filePath)}</span>
                <span x-show="copied === '${escapeHTML(s.filePath)}'" class="text-green-500">✓</span>
                <span x-show="copied !== '${escapeHTML(s.filePath)}'" class="opacity-40">⎘</span>
              </span>
            </div>
            <div class="prose-custom" x-html="renderMarkdown(${escapeJSON(s.body || s.content)})"></div>
          </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- ── MEMORY ── -->
    <div x-show="activeSection === 'memory'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Memory</h1>
      <p class="text-slate-500 text-sm mb-3">Persistent context that carries across Claude sessions</p>
      <div class="section-desc mb-5">
        <p><strong>Memory</strong> files are Markdown files with YAML frontmatter that Claude reads at the start of future sessions, giving it context about you and your projects without you having to re-explain. There are four types: <strong>user</strong> (your role and preferences), <strong>feedback</strong> (corrections to Claude's behavior), <strong>project</strong> (ongoing project context), and <strong>reference</strong> (pointers to external systems). Say "remember this" to Claude to save new memories; it will write them here automatically.</p>
        <p class="mt-1">📍 Files at: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'projects', '-Users-drippingfrog', 'memory'))}')">~/.claude/projects/-Users-drippingfrog/memory/</span></p>
      </div>

      <div class="space-y-4">
        ${Object.entries(memory).map(([file, entry]) => {
          const isIndex = file === 'MEMORY.md';
          const typeColors = { user:'bg-blue-100 text-blue-700', feedback:'bg-amber-100 text-amber-700', project:'bg-green-100 text-green-700', reference:'bg-purple-100 text-purple-700', other:'bg-slate-100 text-slate-600' };
          const typeColor = typeColors[entry.type] || typeColors.other;
          return `
        <div class="card overflow-hidden">
          <div class="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3 cursor-pointer" @click="activeMemoryFile = activeMemoryFile === '${file}' ? null : '${file}'">
            <div class="flex items-center gap-2">
              ${isIndex ? '<span class="text-base">📑</span>' : `<span class="tag ${typeColor}">${escapeHTML(entry.type)}</span>`}
              <span class="font-semibold text-slate-700">${escapeHTML(isIndex ? 'Memory Index' : entry.name)}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="path-pill" @click.stop="copyPath('${escapeHTML(entry.filePath)}')">
                <span class="path-text">${escapeHTML(entry.filePath)}</span>
                <span x-show="copied === '${escapeHTML(entry.filePath)}'" class="text-green-500">✓</span>
                <span x-show="copied !== '${escapeHTML(entry.filePath)}'" class="opacity-40">⎘</span>
              </span>
              <span class="text-slate-400 text-sm" x-text="activeMemoryFile === '${file}' ? '▲' : '▼'"></span>
            </div>
          </div>
          ${!isIndex && entry.description ? `<div class="px-5 py-2 bg-white border-b border-slate-100 text-sm text-slate-500 italic">${escapeHTML(entry.description)}</div>` : ''}
          <div x-show="activeMemoryFile === '${file}'" class="px-5 py-4">
            <div class="prose-custom" x-html="renderMarkdown(${escapeJSON(entry.body || entry.content)})"></div>
          </div>
          ${isIndex ? '' : `
          <div x-show="activeMemoryFile !== '${file}'" class="px-5 py-3">
            <p class="text-sm text-slate-500">${escapeHTML((entry.body || '').slice(0, 200))}${(entry.body || '').length > 200 ? '…' : ''}</p>
          </div>`}
        </div>`;
        }).join('')}
      </div>
    </div>

    <!-- ── PROJECTS ── -->
    <div x-show="activeSection === 'projects'">
      <h1 class="text-2xl font-bold text-slate-800 mb-1">Projects</h1>
      <p class="text-slate-500 text-sm mb-3">Claude's learned context and instincts for each tracked project</p>
      <div class="section-desc mb-5">
        <p>The <strong>Homunculus system</strong> tracks every project you work in with Claude. For each project it collects <strong>observations</strong> (raw tool-use events), derives <strong>instincts</strong> (reusable patterns it learned about your codebase), and inherits global instincts. This per-project learning makes Claude progressively smarter about your specific codebase over time without you needing to re-explain things.</p>
        <p class="mt-1">📍 Files at: <span class="font-mono text-xs cursor-pointer hover:text-claude-600" @click="copyPath('${escapeHTML(path.join(CLAUDE_DIR, 'homunculus', 'projects'))}')">~/.claude/homunculus/projects/</span></p>
      </div>

      <div class="space-y-4">
        ${projects.map(p => `
        <div class="card overflow-hidden">
          <!-- Header -->
          <div class="px-5 py-4 bg-slate-50 border-b border-slate-100">
            <div class="flex items-start justify-between gap-4 flex-wrap">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span class="font-bold text-slate-800 text-lg">${escapeHTML(p.name)}</span>
                  <span class="tag bg-slate-100 text-slate-500 font-mono">${escapeHTML(p.id)}</span>
                </div>
                <div class="flex items-center gap-1 text-sm text-slate-500 mb-1">
                  <span>📁</span>
                  <span class="font-mono truncate">${escapeHTML(p.root)}</span>
                </div>
                ${p.remote ? `<div class="flex items-center gap-1 text-xs text-blue-500"><span>🔗</span><span class="truncate">${escapeHTML(p.remote)}</span></div>` : '<div class="text-xs text-slate-400">No remote configured</div>'}
              </div>
              <div class="flex gap-4 shrink-0 text-center">
                <div><div class="text-2xl font-bold text-green-600">${p.observationCount}</div><div class="text-xs text-slate-400">observations</div></div>
                <div><div class="text-2xl font-bold text-purple-600">${p.personalInstincts.length}</div><div class="text-xs text-slate-400">instincts</div></div>
                <div><div class="text-2xl font-bold text-blue-500">${p.inheritedInstincts.length}</div><div class="text-xs text-slate-400">inherited</div></div>
              </div>
            </div>
            <div class="flex gap-4 mt-3 text-xs text-slate-400 flex-wrap">
              <span>Created <strong class="text-slate-600">${new Date(p.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</strong></span>
              <span>Last seen <strong class="text-slate-600">${new Date(p.lastSeen).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}</strong></span>
            </div>
          </div>

          <!-- Body -->
          <div class="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">

            <!-- Personal Instincts -->
            <div>
              <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Personal Instincts (${p.personalInstincts.length})</div>
              ${p.personalInstincts.length === 0
                ? '<p class="text-xs text-slate-400">None yet — Claude learns instincts as you work</p>'
                : `<div class="space-y-1">${p.personalInstincts.map(i => `
                <div class="text-xs bg-purple-50 border border-purple-100 rounded px-2 py-1">
                  <div class="font-medium text-purple-700">${escapeHTML(i.name)}</div>
                  ${i.summary ? `<div class="text-purple-500 mt-0.5">${escapeHTML(i.summary)}</div>` : ''}
                </div>`).join('')}</div>`}
            </div>

            <!-- Evolved + Inherited -->
            <div class="space-y-3">
              ${p.evolvedAgents.length + p.evolvedCommands.length + p.evolvedSkills.length > 0 ? `
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Evolved Components</div>
                ${p.evolvedAgents.length ? `<div class="mb-1"><span class="text-xs font-medium text-slate-600">Agents: </span>${p.evolvedAgents.map(a => `<span class="tag bg-blue-50 text-blue-600 mr-1">${escapeHTML(a)}</span>`).join('')}</div>` : ''}
                ${p.evolvedCommands.length ? `<div class="mb-1"><span class="text-xs font-medium text-slate-600">Commands: </span>${p.evolvedCommands.map(c => `<span class="tag bg-indigo-50 text-indigo-600 mr-1">${escapeHTML(c)}</span>`).join('')}</div>` : ''}
                ${p.evolvedSkills.length ? `<div><span class="text-xs font-medium text-slate-600">Skills: </span>${p.evolvedSkills.map(s => `<span class="tag bg-emerald-50 text-emerald-600 mr-1">${escapeHTML(s)}</span>`).join('')}</div>` : ''}
              </div>` : ''}

              ${p.inheritedInstincts.length > 0 ? `
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Inherited Instincts (${p.inheritedInstincts.length})</div>
                <div class="flex flex-wrap gap-1">${p.inheritedInstincts.map(i => `<span class="tag bg-slate-100 text-slate-500">${escapeHTML(i)}</span>`).join('')}</div>
              </div>` : ''}

              ${p.recentObs.length > 0 ? `
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Recent Activity</div>
                <div class="flex gap-1 flex-wrap">${p.recentObs.map(t => `<span class="tag bg-amber-50 text-amber-600">${escapeHTML(t)}</span>`).join('')}</div>
              </div>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>

  </main>
</div>

<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
</body>
</html>`;
}

// ─── Live Server Mode ─────────────────────────────────────────────────────────

function startServer(port = 7432) {
  const http = require('http');
  const url = require('url');

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/api/data') {
      // Live data endpoint — re-reads all files on each request
      try {
        const data = collectAllData();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Serve the shell HTML (data fetched client-side)
    const shellHtml = generateHTML(collectAllData());
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(shellHtml);
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = `http://localhost:${port}`;
    process.stdout.write(`\n🚀 Dashboard running at ${addr}\n`);
    process.stdout.write('Press Ctrl+C to stop.\n\n');
    try { execSync(`open "${addr}"`); } catch {}
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
}

function collectAllData() {
  return {
    settings: collectSettings(),
    rules: collectRules(),
    agents: collectAgents(),
    commands: collectCommands(),
    skills: collectSkills(),
    hooks: collectHooks(),
    fileStructure: collectFileStructure(),
    philosophy: collectPhilosophy(),
    memory: collectMemory(),
    projects: collectProjects(),
    stats: collectStats(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const isServe = args.includes('--serve') || args.includes('-s');

  if (isServe) {
    const portArg = args.find(a => /^\d+$/.test(a));
    startServer(portArg ? parseInt(portArg) : 7432);
    return;
  }

  process.stdout.write('Collecting data from ~/.claude/...\n');
  const data = collectAllData();

  process.stdout.write(`  ✓ ${data.agents.length} agents, ${data.commands.length} commands, ${data.skills.length} skills\n`);
  process.stdout.write(`  ✓ ${Object.keys(data.rules).length} rule categories, ${Object.keys(data.memory).length} memory files\n`);
  process.stdout.write(`  ✓ ${data.projects.length} projects tracked\n`);

  process.stdout.write('Generating HTML...\n');
  const html = generateHTML(data);

  fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');
  process.stdout.write(`\n✅ Dashboard written to: ${OUTPUT_FILE}\n`);
  process.stdout.write('Opening in browser...\n');

  try {
    execSync(`open "${OUTPUT_FILE}"`);
  } catch {
    process.stdout.write(`\nOpen manually: file://${OUTPUT_FILE}\n`);
  }
}

main();
