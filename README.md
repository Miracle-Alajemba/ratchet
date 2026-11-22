# Ratchet 🔒

> **Stop AI coding agents from claiming *"Done!"* until a real browser proves every requirement works.**

**Ratchet** is an autonomous **Spec-to-Verified-Code state machine** built on top of **TestMu AI's Kane CLI** and the **Model Context Protocol (MCP)**. It translates plain-English product requirements (`PRD.md`) into binding browser acceptance tests, intercepts live test failures, converts them into token-efficient **Repair Packets**, and locks your workflow (and Git pushes) until 100% of acceptance criteria pass in Google Chrome.

---

## Table of Contents

1. [The Problem: Why AI Coding Agents Ship Broken UIs](#the-problem-why-ai-coding-agents-ship-broken-uis)
2. [The Solution: How Ratchet Works](#the-solution-how-ratchet-works)
3. [System Architecture](#system-architecture)
4. [Repository Layout](#repository-layout)
5. [Prerequisites & Installation](#prerequisites--installation)
6. [Quickstart: Walkthrough with `demo-app`](#quickstart-walkthrough-with-demo-app)
7. [CLI Command Reference](#cli-command-reference)
8. [MCP Server Integration](#mcp-server-integration)
9. [Anatomy of a Repair Packet](#anatomy-of-a-repair-packet)
10. [Hackathon Proof Logging (`kanehack`)](#hackathon-proof-logging-kanehack)
11. [Troubleshooting](#troubleshooting)

---

## The Problem: Why AI Coding Agents Ship Broken UIs

Modern AI coding agents (Antigravity, Claude Code, Cursor, OpenAI Codex) generate code fast, yet routinely declare victory before verifying user-facing behavior:

* **Compilation ≠ Working Software:** TypeScript builds cleanly even when a button handler is miswired, a promo code fails to recalculate totals, or an API response isn't rendered.
* **Agents Take Testing Shortcuts:** Simply prompting an agent *"test this with Kane CLI"* encourages the LLM to write a trivial *"page loads"* check and mark the task complete.
* **Raw Logs Overwhelm Context Windows:** Dumping raw browser execution logs back into an agent wastes tokens and obscures the exact assertion mismatch.
* **No Hard Completion Gate:** Nothing stops unverified code from being committed and pushed to `main`.

---

## The Solution: How Ratchet Works

Named after a mechanical **ratchet wrench**—which turns forward and clicks into place so it cannot slip backward—Ratchet enforces a strict **4-stage closed loop**:

1. **Spec Ingestion (`ratchet sync`):** Reads your `PRD.md` and invokes Kane CLI's assurance pipeline (`context ingest` → `design tests` → `maintain reconcile` → `cover`) to generate binding browser scenarios mapped directly to your requirements.
2. **Headless/Browser Verification (`ratchet verify`):** Spawns `kanehack report -- kane-cli testrun run --agent` with closed `stdin` (preventing interactive TUI hangs) and streams live NDJSON execution events in real time.
3. **Surgical Diagnosis (`RepairPacket`):** Extracts step-level failures, root-cause verdicts, extracted vs. expected DOM/visual values (`context.memory`), and `.evidence` replay commands into a compact JSON packet.
4. **Hard Gate & Pre-Push Lock (`ratchet hook`):** Keeps the state machine `BLOCKED` (`exit 1`) until every acceptance criterion passes in Chrome (`PROVEN`, `locked: true`, `exit 0`), and optionally blocks `git push` via `.git/hooks/pre-push`.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RATCHET CLOSED-LOOP PIPELINE                         │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     ratchet sync      ┌──────────────────────────────────┐
  │    PRD.md    │ ────────────────────▶ │        Kane CLI Assurance        │
  │ (User Specs) │                       │  context ingest + design tests   │
  └──────────────┘                       └─────────────────┬────────────────┘
         ▲                                                 │
         │                                                 ▼
  ┌──────┴───────────────┐                       ┌──────────────────────────┐
  │  AI Coding Agent     │                       │   Binding *_test.md      │
  │ (Patches App Source) │                       │   Acceptance Scenarios   │
  └──────▲───────────────┘                       └─────────┬────────────────┘
         │                                                 │
         │  RepairPacket (JSON)                            │ ratchet verify
         │  • Root Cause & Culprit Step                    ▼
         │  • Expected vs. Actual Values         ┌──────────────────────────┐
  ┌──────┴───────────────┐   NDJSON Stream       │   Kane CLI Browser Run   │
  │   Ratchet Engine     │ ◀──────────────────── │ (Real Chrome + Evidence) │
  │ runner.ts + packet.ts│                       └─────────┬────────────────┘
  └──────┬───────────────┘                                 │
         │                                                 ▼
         │  100% Criteria Proven                 ┌──────────────────────────┐
         └─────────────────────────────────────▶ │   RATCHET LOCKED (✔)     │
                                                 │  Allows Completion/Push  │
                                                 └──────────────────────────┘
```

---

## Repository Layout

```text
ratchet/
├── .agents/
│   └── skills/
│       └── ratchet/
│           └── SKILL.md             # Antigravity/Codex agent skill definition
├── bin/
│   └── ratchet.js                   # CLI executable entrypoint
├── demo-app/
│   ├── .testmuai/                   # Kane CLI assurance & evidence store
│   │   ├── evidence/                # Sealed .evidence execution packs
│   │   └── tests/
│   │       ├── checkout_test.md     # Generated Kane acceptance test
│   │       └── output-checkout/     # Cached execution recordings & MD5 proofs
│   ├── index.html                   # Pro Plan checkout UI implementation
│   └── PRD.md                       # Plain-English acceptance criteria
├── src/
│   ├── engine/
│   │   ├── packet.ts                # RepairPacket builder & failure analyzer
│   │   ├── runner.ts                # Kane CLI child process runner & NDJSON parser
│   │   └── spec.ts                  # PRD parser & test generator
│   ├── mcp/
│   │   └── server.ts                # MCP server for IDE agent integration
│   └── index.ts                     # Commander CLI implementation
├── package.json
└── tsconfig.json
```

---

## Prerequisites & Installation

### Prerequisites
1. **Node.js**: `>= 18.17.0` (v20+ recommended)
2. **Google Chrome / Chromium**: Installed locally (`google-chrome --version`)
3. **Kane CLI**: Installed globally and authenticated
   ```bash
   npm install -g @testmuai/kane-cli@rc
   kane-cli whoami
   ```
4. **Kanehack (Optional for hackathon tracking)**:
   ```bash
   npm install -g @testmuai/kanehack
   ```

### Installation
Clone and link `ratchet` locally:
```bash
git clone git@github.com:Miracle-Alajemba/ratchet.git
cd ratchet
npm install
npm link
```

Verify the installation:
```bash
ratchet --help
```

---

## Quickstart: Walkthrough with `demo-app`

The included `demo-app/` demonstrates Ratchet's complete closed loop.

### 1. Requirements Specification
Define acceptance criteria in `demo-app/PRD.md`:
```markdown
# Product Requirements Document: Pro Plan Checkout

Target URL: http://localhost:4173

## Acceptance Criteria
- Base price displays $100.
- Entering promo code SAVE20 and clicking "Apply" updates the total to $80 and shows "Discount applied".
- Clicking "Complete Order" after applying SAVE20 displays "Order Confirmed: $80 paid".
```

### 2. Start Local App
```bash
npx serve demo-app -l 4173 &
```

### 3. Ingest Specs
```bash
cd demo-app
ratchet sync --prd PRD.md
```
Output:
```text
⚙ Syncing spec from PRD.md...
✔ Context ingested & acceptance tests designed.
Coverage: 3 / 3 acceptance criteria mapped to Kane CLI scenarios (100%).
```

### 4. Verification Gate Catches Defect
When `demo-app/index.html` contains a bug where `SAVE20` fails to discount:
```bash
ratchet verify --no-report --json
```
Output:
```json
{
  "status": "BLOCKED",
  "locked": false,
  "summary": "Ratchet verification gate blocked: promo code not applied",
  "evidence": {
    "executionId": "cce2a7d0-b1e2-4f45-9e2a-74cf83cc3a26",
    "evidencePack": "demo-app/.testmuai/evidence/cce2a7d0.evidence",
    "replayCommand": "kane-cli evidence serve demo-app/.testmuai/evidence/cce2a7d0.evidence"
  },
  "failureAnalysis": {
    "rootCause": "AP determined agent is stuck — no viable actions remain",
    "failedStep": 2,
    "memoryDiffs": [
      {
        "check": "Total price after promo SAVE20",
        "expected": "$80",
        "actual": "$100"
      }
    ]
  },
  "coverage": {
    "output": "Coverage: 3 / 3 acceptance criteria mapped to Kane CLI scenarios (100%)."
  }
}
```
*Process exits with code `1`.*

### 5. Self-Healing & Lock
Patch the bug in `demo-app/index.html` and re-verify:
```bash
ratchet verify --no-report --json
```
Output:
```json
{
  "status": "PROVEN",
  "locked": true,
  "summary": "All acceptance criteria verified and proven by Kane CLI.",
  "evidence": {
    "executionId": "1f053511-38d8-40f7-865f-44957fb033a4",
    "evidencePack": "demo-app/.testmuai/evidence/1f053511.evidence",
    "replayCommand": "kane-cli evidence serve demo-app/.testmuai/evidence/1f053511.evidence"
  },
  "coverage": {
    "output": "Coverage: 3 / 3 acceptance criteria mapped to Kane CLI scenarios (100%)."
  }
}
```
*Process exits with code `0`. Code is locked and ready to push.*

---

## CLI Command Reference

### `ratchet init`
Scaffolds the Antigravity/Codex `SKILL.md`, creates a starter `PRD.md`, and prints MCP server configuration snippets.
```bash
ratchet init
```

### `ratchet sync`
Ingests a PRD markdown document and writes Kane CLI acceptance scenarios to disk.
```bash
ratchet sync --prd PRD.md
```
- `-p, --prd <path>`: Path to requirement specification (default: `PRD.md`).

### `ratchet verify`
Executes Kane CLI test runner against the running application and evaluates the lock gate.
```bash
ratchet verify [options]
```
- `-t, --target <path>`: Specific `_test.md` file or scenario name.
- `--no-report`: Skip wrapping execution with `kanehack report`.
- `--json`: Emit machine-readable `RepairPacket` JSON (ideal for agent loops).

### `ratchet hook`
Installs a `.git/hooks/pre-push` gate in the current repository that runs `ratchet verify` before allowing any branch to be pushed.
```bash
ratchet hook
```

---

## MCP Server Integration

Ratchet provides a native **Model Context Protocol (MCP)** server over stdio. This lets agents in Claude Code, Cursor, Antigravity, and Codex invoke the verification gate via tool calls.

### Configuration
Add Ratchet to your MCP settings (`~/.gemini/config/mcp_config.json` or equivalent):
```json
{
  "mcpServers": {
    "ratchet": {
      "command": "node",
      "args": ["/absolute/path/to/ratchet/bin/ratchet.js", "mcp"]
    }
  }
}
```

### Tools Exposed to Agents
| Tool Name | Parameters | Description |
|---|---|---|
| `ratchet_sync` | `prdPath` (string), `cwd` (string) | Ingests `PRD.md` and generates Kane CLI acceptance scenarios |
| `ratchet_verify` | `target` (string), `cwd` (string), `reportProof` (bool) | Executes browser tests and returns structured `RepairPacket` |
| `ratchet_coverage` | `cwd` (string) | Queries current requirements coverage status |

---

## Anatomy of a Repair Packet

A `RepairPacket` is a structured TypeScript object designed to give coding LLMs everything needed to debug failures in a single turn without context explosion:

```typescript
export interface RepairPacket {
  status: "PROVEN" | "BLOCKED";
  locked: boolean;
  summary: string;
  evidence: {
    executionId?: string;
    evidencePack?: string;
    replayCommand?: string;
  };
  failureAnalysis?: {
    rootCause: string;
    failedStep?: string | number;
    memoryDiffs: Array<{
      check: string;
      expected: any;
      actual: any;
    }>;
  };
  coverage: {
    output: string;
  };
  timestamp: string;
}
```

---

## Hackathon Proof Logging (`kanehack`)

When run without `--no-report`, `ratchet verify` automatically wraps execution with `kanehack report`:
```bash
kanehack report -- kane-cli testrun run --agent
```
This logs anonymous run proof, exit codes, and sealed evidence hashes to the TestMu AI hackathon dashboard without leaking sensitive environment tokens.

---

## Troubleshooting

### 1. `kane-cli` Not Found in PATH
Ensure `~/.local/bin` and `~/.npm-global/bin` are in your `PATH`:
```bash
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
```

### 2. Interactive TUI Hangs
Kane CLI expects a non-TTY `stdin` to emit NDJSON streams. Ratchet automatically handles this by spawning child processes with `stdio: ["ignore", "pipe", "pipe"]`.

### 3. Screen/Font Capture Timeouts
If running in minimal Linux environments without standard web fonts, specify `sans-serif` or install standard font packages (`fonts-liberation`, `fonts-dejavu-core`).

---

## License

ISC License © 2026 Miracle Alajemba. Built with TestMu AI Kane CLI & Model Context Protocol.
