# Ratchet 🔒

> **Stop AI coding agents from claiming *"Done!"* until a real browser proves every requirement works.**

**Ratchet** is an autonomous **Spec-to-Verified-Code state machine** built on top of **TestMu AI's Kane CLI** and the **Model Context Protocol (MCP)**. It translates plain-English product requirements (`PRD.md`) into binding browser acceptance tests using Kane CLI's assurance pipeline, intercepts live test failures, converts them into token-efficient **Repair Packets**, and locks your workflow (and Git pushes) until 100% of acceptance criteria pass in Google Chrome.

---

## Table of Contents

1. [The Problem: Why AI Coding Agents Ship Broken UIs](#the-problem-why-ai-coding-agents-ship-broken-uis)
2. [The Solution: How Ratchet Works](#the-solution-how-ratchet-works)
3. [System Architecture](#system-architecture)
4. [Verification Correctness & Fail-Closed Guarantees](#verification-correctness--fail-closed-guarantees)
5. [Repository Layout](#repository-layout)
6. [Prerequisites & Installation](#prerequisites--installation)
7. [Quickstart: Walkthrough with `demo-app`](#quickstart-walkthrough-with-demo-app)
8. [CLI Command Reference](#cli-command-reference)
9. [MCP Server Integration](#mcp-server-integration)
10. [Anatomy of a Repair Packet](#anatomy-of-a-repair-packet)
11. [Git Hook Integration & Security](#git-hook-integration--security)
12. [Hackathon Proof Logging (`kanehack`)](#hackathon-proof-logging-kanehack)
13. [Troubleshooting](#troubleshooting)

---

## The Problem: Why AI Coding Agents Ship Broken UIs

Modern AI coding agents (Antigravity, Claude Code, Cursor, OpenAI Codex) generate code fast, yet routinely declare victory before verifying user-facing behavior:

* **Compilation ≠ Working Software:** TypeScript builds cleanly even when a button handler is miswired, a promo code fails to recalculate totals, or an API response isn't rendered.
* **Agents Take Testing Shortcuts:** Simply prompting an agent *"test this with Kane CLI"* encourages the LLM to write a trivial *"page loads"* check and mark the task complete.
* **Test Rewriting & Assertion Weakening:** Autonomous agents sometimes alter test files or weaken assertions when tests fail, faking a passing state.
* **Raw Logs Overwhelm Context Windows:** Dumping raw browser execution logs back into an agent wastes tokens and obscures the exact assertion mismatch.
* **No Hard Completion Gate:** Nothing stops unverified code from being committed and pushed to `main`.

---

## The Solution: How Ratchet Works

Named after a mechanical **ratchet wrench**—which turns forward and clicks into place so it cannot slip backward—Ratchet enforces a strict **4-stage closed loop**:

1. **Spec Ingestion (`ratchet sync`):** Ingests your `PRD.md` through Kane CLI's official assurance workflow (`context ingest` → `context extract` → `design tests` → `cover`). It extracts use cases (`uc-X`), acceptance criteria (`ac-X`), scenarios (`sc-X`), and designs binding test files (`*_test.md`) with `@verifies ac-X` annotations. A cryptographic manifest (`.testmuai/.ratchet_manifest.json`) records SHA-256 hashes of the PRD and test files to detect any post-sync modifications.
2. **Headless/Browser Verification (`ratchet verify`):** Validates manifest integrity, then spawns the Kane CLI testrunner (`kane-cli testrun run --agent`) with closed `stdin` to prevent interactive TUI hangs. Ratchet parses execution events incrementally via streaming NDJSON.
3. **Surgical Diagnosis (`RepairPacket`):** When a run fails, Ratchet extracts root-cause verdicts, failing steps, memory/DOM diffs, and `.evidence` replay commands directly from Kane CLI's structured failure payload—without hardcoded assumptions or guessed values.
4. **Hard Gate & Pre-Push Lock (`ratchet hook`):** Keeps the state machine `BLOCKED` (`exit 1`) until every acceptance criterion passes in Chrome (`PROVEN`, `locked: true`, `exit 0`), and safely chains with existing Git pre-push hooks.

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
  │ (Patches App Source) │                       │   (@verifies ac-X tags)  │
  └──────▲───────────────┘                       └─────────┬────────────────┘
         │                                                 │
         │  RepairPacket (JSON)                            │ ratchet verify
         │  • Root Cause & Culprit Step                    │ (Integrity Check)
         │  • Structured Memory Diffs                      ▼
  ┌──────┴───────────────┐   NDJSON Stream       ┌──────────────────────────┐
  │   Ratchet Engine     │ ◀──────────────────── │   Kane CLI Browser Run   │
  │ runner.ts + packet.ts│                       │ (Real Chrome + Evidence) │
  └──────┬───────────────┘                       └─────────┬────────────────┘
         │                                                 │
         │  100% Criteria Proven                           ▼
         └─────────────────────────────────────▶ ┌──────────────────────────┐
                                                 │   RATCHET LOCKED (✔)     │
                                                 │  Allows Completion/Push  │
                                                 └──────────────────────────┘
```

---

## Verification Correctness & Fail-Closed Guarantees

Ratchet is built around rigorous verification correctness and fail-closed security:

### 1. Genuine Kane CLI Requirements-to-Tests Workflow
* `ratchet sync` executes Kane CLI's documented pipeline:
  ```bash
  kane-cli context ingest --local <prdPath> --mode ci
  kane-cli context extract --mode ci --json
  kane-cli design tests --use-case <id> --allow-unreviewed --mode ci --json
  kane-cli cover --json
  kane-cli cover gaps --json
  ```
* **No Phantom Coverage:** An acceptance criterion is counted as covered **only** when a real Kane test maps directly to it (via `@verifies ac-X`). Uncovered criteria are explicitly surfaced as coverage gaps.
* **Stop on Blocker:** If Kane CLI is missing, unauthenticated, or fails to execute the assurance pipeline, Ratchet halts and reports the specific blocker immediately; it never fabricates assurance or test coverage.

### 2. Tamper & Staleness Detection (Cryptographic Manifest)
* During `sync`, Ratchet writes `.testmuai/.ratchet_manifest.json` containing SHA-256 hashes of the PRD and all generated test files.
* Before executing tests, `ratchet verify` checks the manifest:
  * **Stale Tests:** If `PRD.md` was edited after `sync`, Ratchet blocks execution and requires re-running `ratchet sync`.
  * **Altered Tests:** If an agent tampered with, deleted, or weakened generated test assertions, Ratchet halts with `status: "BLOCKED"` and reports the exact altered test paths.

### 3. Fail-Closed Runner & Incremental NDJSON Parsing
* `runner.ts` implements a streaming NDJSON chunk parser that buffers partial lines across chunks without drops or truncation.
* Multi-command surface detection supports `testrun`, `testmd`, and legacy `run`.
* **Zero False Passes:** A test run passes **only** if:
  1. The top-level completion event is received (e.g. `testrun_done.overall_status === "passed"`).
  2. Every member/scenario completes with status `"passed"` (no `failed`, `broken`, `interrupted`, or `cancelled` members).
  3. The child process exits with `code === 0`.
* A missing completion event, non-zero exit code, process spawn error, or interrupted execution always yields `status: "BLOCKED"` and exit code `1`.

### 4. Generic Repair Packets
* Diagnostics in `RepairPacket` are synthesized exclusively from Kane CLI's structured failure payload (`assertion_tree`, `context.memory`, `action_params`).
* If Kane CLI output lacks diagnostic details, Ratchet reports `"unavailable"` instead of hallucinating expected or actual values.

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
│   │   ├── tests/
│   │   │   └── checkout_test.md     # Generated Kane acceptance test
│   │   └── .ratchet_manifest.json   # SHA-256 integrity manifest
│   ├── index.html                   # Pro Plan checkout UI implementation
│   └── PRD.md                       # Plain-English acceptance criteria
├── src/
│   ├── engine/
│   │   ├── hook.ts                  # Safe pre-push hook installer
│   │   ├── packet.ts                # Generic RepairPacket builder
│   │   ├── runner.ts                # Incremental NDJSON runner & fail-closed engine
│   │   └── spec.ts                  # Kane assurance pipeline & manifest verifier
│   ├── mcp/
│   │   └── server.ts                # MCP server for agent IDEs
│   └── index.ts                     # Commander CLI implementation
├── test/                            # Node 24 native test suite (18 unit/integration tests)
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
Clone and build `ratchet` locally:
```bash
git clone https://github.com/Miracle-Alajemba/ratchet.git
cd ratchet
npm install
npm run build
npm test
npm link
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
Ingests a PRD markdown document via Kane CLI's assurance pipeline, writes test scenarios with `@verifies` annotations, and updates the integrity manifest.
```bash
ratchet sync --prd PRD.md
```
- `-p, --prd <path>`: Path to requirement specification (default: `PRD.md`).

### `ratchet verify`
Verifies manifest integrity, executes Kane CLI's testrunner against the application, and evaluates the lock gate.
```bash
ratchet verify [options]
```
- `-t, --target <path>`: Specific `_test.md` file or scenario name.
- `-p, --prd <path>`: Path to requirement specification for integrity checks (default: `PRD.md`).
- `--no-report`: Skip wrapping execution with `kanehack report`.
- `--json`: Emit machine-readable `RepairPacket` JSON (ideal for agent loops).

### `ratchet hook`
Installs or chains a `.git/hooks/pre-push` gate in the repository.
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
| `ratchet_sync` | `prdPath` (string), `cwd` (string) | Ingests `PRD.md` via Kane CLI assurance workflow and records integrity manifest |
| `ratchet_verify` | `target` (string), `prdPath` (string), `cwd` (string), `reportProof` (bool) | Checks manifest integrity, executes browser tests, and returns structured `RepairPacket` |
| `ratchet_coverage` | `cwd` (string) | Queries current requirements coverage status and reports gap criteria |

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

## Git Hook Integration & Security

Running `ratchet hook` configures `.git/hooks/pre-push`:
* **Hook Chaining:** If an existing `pre-push` hook is present, Ratchet preserves it as `pre-push.legacy` and safely chains to it so other pre-push checks still run.
* **Security & Bypassability Notice:** Local Git hooks provide workflow guidance and developer guardrails, but client-side Git hooks can be bypassed (e.g., using `git push --no-verify` or manual file manipulation). For tamper-proof gating, enforce `ratchet verify` as a mandatory status check in your CI/CD pipeline (e.g. GitHub Actions).

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

ISC License © 2026. Built with TestMu AI Kane CLI & Model Context Protocol.
