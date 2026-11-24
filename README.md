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
⚙ Syncing spec from PRD.md via Kane CLI assurance workflow...
✔ Kane context ingested & acceptance tests designed.
  PRD Path: PRD.md
  Generated test files: complete-the-discounted-pro-plan-purchase_test.md

Acceptance Criteria to Kane Tests Mapping:
  ✔ [ac-1] Base price displays $100.
      ↳ Test: t-2 in complete-the-discounted-pro-plan-purchase_test.md
  ✔ [ac-2] Entering promo code SAVE20 and clicking "Apply" updates the total to $80...
      ↳ Test: t-2 in complete-the-discounted-pro-plan-purchase_test.md
  ✔ [ac-3] ...shows "Discount applied".
      ↳ Test: t-2 in complete-the-discounted-pro-plan-purchase_test.md
  ✔ [ac-4] Clicking "Complete Order" after applying SAVE20 displays "Order Confirmed: $80 paid".
      ↳ Test: t-2 in complete-the-discounted-pro-plan-purchase_test.md

Coverage: 4 / 4 acceptance criteria mapped to Kane CLI scenarios (100% designed, 4 total).
```

### 4. Verification Gate Catches Defect
When `demo-app/index.html` contains a bug where `SAVE20` fails to discount:
```bash
ratchet verify --target .testmuai/tests/complete-the-discounted-pro-plan-purchase_test.md --no-report --json
```
Captured Output:
```json
{
  "status": "BLOCKED",
  "locked": false,
  "summary": "Ratchet verification gate blocked (Confirmed Product Defect): The checkout treats SAVE20 as invalid even though this checkout flow requires it to reduce the price from $100 to $80.",
  "evidence": {
    "executionId": "f61ce14d-fbda-4290-80c0-1d38c458a13b",
    "evidencePack": "/home/user/.testmuai/kaneai/sessions/f61ce14d-fbda-4290-80c0-1d38c458a13b/evidence/a131c194-9345-49f9-8b82-a6a90fb5193b.evidence",
    "replayCommand": "kane-cli evidence serve /home/user/.testmuai/kaneai/sessions/f61ce14d-fbda-4290-80c0-1d38c458a13b/evidence/a131c194-9345-49f9-8b82-a6a90fb5193b.evidence"
  },
  "failureAnalysis": {
    "defectType": "product_defect",
    "isConfirmedProductBug": true,
    "rootCause": "The checkout treats SAVE20 as invalid even though this checkout flow requires it to reduce the price from $100 to $80.",
    "failedStep": 2,
    "memoryDiffs": [],
    "diagnostics": [
      "The checkout rejects SAVE20 instead of applying the expected discount.",
      "Bug: SAVE20 promo code rejected at Pro Plan checkout",
      "Suggestion: Check the promo-code rules and configuration for the Pro Plan checkout so SAVE20 is accepted and shows “Discount applied” with a total of $80."
    ]
  },
  "coverage": {
    "output": "Coverage: 1 / 4 acceptance criteria proven by Kane CLI (25% proven, 4 designed).",
    "totalCriteria": 4,
    "coveredCriteria": 4,
    "provenCriteria": 1
  },
  "timestamp": "2026-11-23T02:26:44.225Z"
}
```
*Process exits with code `1`.*

### 5. Self-Healing & Lock
Patch the bug in `demo-app/index.html` and re-verify:
```bash
ratchet verify --target .testmuai/tests/complete-the-discounted-pro-plan-purchase_test.md --no-report --json
```
Captured Output:
```json
{
  "status": "PROVEN",
  "locked": true,
  "summary": "All 4 acceptance criteria verified and proven by Kane CLI.",
  "evidence": {
    "executionId": "eb8d2e66-367e-46ae-b2d8-39f67b6e66e2",
    "evidencePack": "/home/user/.testmuai/kaneai/sessions/eb8d2e66-367e-46ae-b2d8-39f67b6e66e2/evidence/711d9320-6597-4d12-8e4f-ee11f3d922e8.evidence",
    "replayCommand": "kane-cli evidence serve /home/user/.testmuai/kaneai/sessions/eb8d2e66-367e-46ae-b2d8-39f67b6e66e2/evidence/711d9320-6597-4d12-8e4f-ee11f3d922e8.evidence"
  },
  "coverage": {
    "output": "Coverage: 4 / 4 acceptance criteria proven by Kane CLI (100% proven, 4 designed).",
    "totalCriteria": 4,
    "coveredCriteria": 4,
    "provenCriteria": 4
  },
  "timestamp": "2026-11-23T02:49:18.737Z"
}
```
*Process exits with code `0`. All 4 criteria are proven, and the gate is locked.*

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
Running `ratchet init` automatically prints the exact configuration for your local environment:
```json
{
  "mcpServers": {
    "ratchet": {
      "command": "node",
      "args": [
        "/path/to/ratchet/dist/mcp/server.js"
      ]
    }
  }
}
```
Add this snippet to your Antigravity / Claude / Cursor MCP configuration (e.g. `~/.gemini/config/mcp_config.json`). The server runs directly via Node with the compiled entrypoint (`dist/mcp/server.js`).

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
export interface MemoryDiff {
  check: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
}

export interface FailureAnalysis {
  defectType: "product_defect" | "test_execution_failure";
  isConfirmedProductBug: boolean;
  rootCause: string;
  failedStep?: string | number;
  failedMember?: string;
  memoryDiffs: MemoryDiff[];
  diagnostics?: string[];
}

export interface RepairPacket {
  status: "PROVEN" | "PASSED_BUT_UNPROVEN" | "BLOCKED";
  locked: boolean;
  summary: string;
  evidence: {
    executionId?: string;
    evidencePack?: string;
    replayCommand?: string;
  };
  failureAnalysis?: FailureAnalysis;
  coverage?: {
    output: string;
    totalCriteria?: number;
    coveredCriteria?: number;
    provenCriteria?: number;
    gaps?: any[];
  };
  timestamp: string;
}
```

### Verification States:
* **`PROVEN` (`locked: true`, exit code `0`):** Execution completed cleanly and 100% of the owed acceptance criteria were verified and proven by Kane CLI in Chrome.
* **`PASSED_BUT_UNPROVEN` (`locked: false`, exit code `1`):** The test process completed without mechanical errors, but Kane CLI reports 0 (or incomplete) proven criteria (e.g., no binding `@verifies` scenarios were exercised). Ratchet never grants lock without proven coverage.
* **`BLOCKED` (`locked: false`, exit code `1`):** A verification failure occurred. Ratchet categorizes the failure:
  * **Confirmed Product Defect (`defectType: "product_defect"`, `isConfirmedProductBug: true`):** Set **only** when Kane CLI's structured verdict explicitly confirms an application defect (`confirmed === true`).
  * **Unconfirmed Verification Failure (`defectType: "test_execution_failure"`, `isConfirmedProductBug: false`):** Assigned when an assertion failure, browser timeout, or step failure occurs without an explicit `confirmed: true` bug verdict (e.g. `family: "application_issue"` or `result_code: 740` alone is not confirmation). Ratchet will not falsely claim a product bug unless Kane explicitly confirms it.

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
