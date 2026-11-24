# Ratchet 🔒

> **Stop AI coding agents from claiming *"Done!"* until a real browser proves every requirement works.**
> Built for the **TestMu AI KaneCLI Online Hackathon 2026**.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Kane CLI](https://img.shields.io/badge/Powered%20By-Kane%20CLI%20%40rc-orange.svg)](https://testmu.ai/)
[![MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Unit%20Tests-33%2F33%20Passed-brightgreen.svg)]()
[![Proven Coverage](https://img.shields.io/badge/Proven%20Coverage-9%2F9%20Criteria%20(100%25)-success.svg)]()

---

## ⚡ Quickstart for Judges (< 3 Minutes)

Judges can verify Ratchet, run the test suite, and inspect the browser verification pipeline in under 3 minutes with these exact copy-paste commands:

```bash
# 1. Clone repository and install dependencies
git clone https://github.com/Miracle-Alajemba/ratchet.git
cd ratchet
npm install

# 2. Build TypeScript engine and MCP server
npm run build

# 3. Run all 33 offline unit & regression tests (0 credits used, < 1 second)
npm test

# 4. Start the included demo app in the background
cd demo-app
python3 -m http.server 4173 &

# 5. Run Ratchet browser verification (using Kane CLI's agent mode)
node ../bin/ratchet.js verify --target .testmuai/tests/check-80-paid-pro-plan-confirmation-after-save20_test.md --json
```

*See [Proof & Verification Results](#-proof--verification-results) for full audit logs and metrics.*

---

## 📑 Table of Contents

1. [What Ratchet Is & The Closed Loop](#-what-ratchet-is--the-closed-loop)
2. [Supported AI Coding Agents](#-supported-ai-coding-agents)
3. [Architecture & Flow](#-architecture--flow)
4. [Proof & Verification Results (100% Proven)](#-proof--verification-results)
5. [How Kane CLI Browser Verification Works](#-how-kane-cli-browser-verification-works)
6. [Resilient Sync & EMPTY_DESIGN Handling](#-resilient-sync--empty_design-handling)
7. [Anatomy of a Repair Packet](#-anatomy-of-a-repair-packet)
8. [CLI Command Reference](#-cli-command-reference)
9. [Model Context Protocol (MCP) Server](#-model-context-protocol-mcp-server)
10. [Git Hook Integration & Tamper Resistance](#-git-hook-integration--tamper-resistance)
11. [Project Links & Submission Media](#-project-links--submission-media)

---

## 💡 What Ratchet Is & The Closed Loop

Modern AI coding agents generate functional-looking code in seconds, yet routinely hallucinate completion:
* **"Code compiles, so it must work"** — TypeScript builds cleanly even if a promo discount fails to update totals or a button handler drops state.
* **Agents take testing shortcuts** — Asked to test with Kane CLI, an LLM often writes a trivial *"page loads"* smoke test and calls the job done.
* **Assertion tampering** — When browser tests fail, agents are notorious for editing test files or deleting assertions to force a green status.
* **Raw logs overwhelm LLM context** — Dumping megabytes of browser logs into context windows wastes tokens and obscures root causes.

### The Ratchet Closed Loop
Named after the mechanical **ratchet wrench**—which turns forward and clicks into place so it cannot slip backward—**Ratchet** is an autonomous **Spec-to-Verified-Code gatekeeper**:

1. **Ingest Specs (`ratchet sync`):** Reads your plain-English `PRD.md` and uses Kane CLI's assurance pipeline (`context ingest` → `context extract` → `design tests`) to generate binding test scenarios with explicit `@verifies ac-X` annotations.
2. **Seal Manifest:** Calculates SHA-256 hashes of the PRD and all test files into `.testmuai/.ratchet_manifest.json`. Any agent attempt to tamper with test files or skip criteria trips an immediate `BLOCKED` lock.
3. **Real Browser Execution (`ratchet verify`):** Launches headless Google Chrome via `kane-cli testrun run --agent`, streaming NDJSON events in real-time.
4. **Surgical Feedback (`RepairPacket`):** When browser assertions fail, Ratchet filters raw logs into a structured, token-efficient JSON packet containing root causes, failing step indices, DOM memory diffs, and replay commands.
5. **Hard Pre-Push Gate (`ratchet hook`):** Keeps Git commits and pushes blocked (`exit 1`) until Kane CLI proves **100% of acceptance criteria** in Chrome (`PROVEN`, `locked: true`, `exit 0`).

---

## 🤖 Supported AI Coding Agents

Ratchet integrates natively into any agentic development workflow:

| Agent / Environment | Integration Method | Capabilities |
|---|---|---|
| **Google Antigravity** | Agent Skill (`.agents/skills/ratchet`) + MCP Server | Direct tool-call invocation of `ratchet_sync`, `ratchet_verify`, and `ratchet_coverage` |
| **Claude Code** | MCP Server (`mcpServers.ratchet` in config) | Automatic tool invocation for self-healing repair loops |
| **Cursor** | MCP Server (stdio) | In-editor chat agent runs verification gate and repairs defects |
| **OpenAI Codex / CLI** | CLI (`ratchet sync`, `ratchet verify`, `ratchet hook`) | Pre-push Git hook blocks invalid pushes; CLI outputs structured JSON |

---

## 🏗 Architecture & Flow

```text
 ┌──────────────┐
 │    PRD.md    │ ─── 1. User specifies acceptance criteria (e.g. "$100 base, SAVE20 -> $80")
 └──────┬───────┘
        │
        ▼
 ┌──────────────┐     kane-cli context ingest & design
 │ ratchet sync │ ─── 2. Generates binding *_test.md with @verifies ac-X tags
 └──────┬───────┘        Locks hashes in .testmuai/.ratchet_manifest.json
        │
        ▼
 ┌────────────────┐
 │ AI Agent Loop  │ ─── 3. Agent writes or edits frontend/backend source code
 └──────┬─────────┘
        │
        ▼
 ┌────────────────┐   kane-cli testrun run --agent
 │ ratchet verify │ ─── 4. Executes real headless Google Chrome
 └──────┬─────────┘        Streams execution events via chunk-safe NDJSON parser
        │
        ├── [Verification Fails] ──▶ Emits RepairPacket (root cause, failing step, DOM diffs)
        │                            Agent repairs code and loops back to Step 4
        │
        ▼ [All Criteria Pass in Browser]
 ┌────────────────────────┐
 │ cover gaps --json      │ ─── 5. Verifies 100% criteria coverage roll-up
 └──────┬─────────────────┘
        │
        ▼
 ┌────────────────────────┐
 │  RATCHET LOCKED (✔)    │ ─── 6. Sets locked: true, status: "PROVEN", unblocks Git push
 └────────────────────────┘
```

### Step-by-Step Flow:
* **Step 1: Specification** — Plain-English acceptance criteria defined in `PRD.md`.
* **Step 2: Assurance Mapping** — `ratchet sync` runs Kane CLI pipeline to design deterministic test markdown and binds each requirement to an `@verifies ac-X` tag.
* **Step 3: Cryptographic Integrity** — Manifest records SHA-256 hashes of PRD and generated tests to prevent agent assertion-tampering.
* **Step 4: Browser Execution** — `ratchet verify` executes headless Chrome, streaming NDJSON output with closed `stdin` to avoid interactive TUI hangs.
* **Step 5: Defect Diagnosis & Repair** — On failure, Ratchet synthesizes a structured `RepairPacket` with verified bug classifications and memory diffs, guiding the agent to fix the app code.
* **Step 6: Gap Rollup & Proof** — Evaluates Kane CLI's `cover gaps --json` roll-up.
* **Step 7: Workflow Lock** — Only when 100% of criteria are proven does Ratchet issue `locked: true` (`exit 0`), permitting completion and unblocking Git pushes.

---

## 📊 Proof & Verification Results

During hackathon testing with the Pro Plan Checkout application (`demo-app/`), Ratchet achieved complete, verifiable proof across all requirements:

| Metric | Result | Audit Verification |
|---|---|---|
| **Use Cases Designed & Verified** | **4 / 4 (100%)** | `uc-1`, `uc-2`, `uc-3`, `uc-4` in `.testmuai/.ratchet_manifest.json` |
| **Acceptance Criteria Proven** | **9 / 9 (100%)** | `ac-5`, `ac-6`, `ac-7`, `ac-8`, `ac-9`, `ac-11`, `ac-12`, `ac-13`, `ac-14` |
| **Offline Unit & Regression Tests** | **33 / 33 Passed** | `npm test` runs across NDJSON parser, RepairPacket, and gaps contract |
| **Tamper & Staleness Detection** | **Pass (Fail-Closed)** | Tested against modified PRDs, deleted tests, and altered assertions |
| **Live Browser Execution** | **Proven in Chrome** | Headless Chrome verified base price, promo recalculation, and order confirmation |

### Verification Manifest Extract (`demo-app/.testmuai/.ratchet_manifest.json`)
```json
{
  "manifestVersion": 1,
  "prdPath": "PRD.md",
  "prdHash": "sha256:b33de67b0e8825ffec832e8ff4fb161f435c0b827363322e39a319e5b69199ae",
  "criteriaCount": 9,
  "provenCoverage": "100%"
}
```

---

## 🌐 How Kane CLI Browser Verification Works

Unlike unit tests or simulated JSDOM environments, Ratchet relies strictly on **Kane CLI (`kane-cli`)** for ground-truth browser verification:

1. **Real Headless Chrome:** Kane CLI spins up genuine Chrome instances, executing actual clicks, typing, navigation, and asynchronous UI updates.
2. **Visual & DOM Action Traces:** Every interaction records DOM snapshots, computed styles, bounding boxes, and action outcomes.
3. **Non-TTY Headless Streaming:** Ratchet spawns Kane with `stdio: ["ignore", "pipe", "pipe"]`, closing `stdin` to prevent TUI interactive prompts and ensuring clean, uninterrupted NDJSON event streams.
4. **Failure Verdicts:** Kane categorizes failures into structured verdicts (e.g. `confirmed: true` product defects vs. environment timeouts). Ratchet surfaces confirmed bugs without inventing or guessing details.
5. **Sealed `.evidence` Packs:** Every run stores replayable session artifacts in `.testmuai/evidence/`, allowing developers or judges to inspect step replays using `kane-cli evidence serve <id>`.

---

## 🛡 Resilient Sync & EMPTY_DESIGN Handling

In iterative development, re-running `ratchet sync` against an already-designed use case can result in Kane CLI emitting:
```text
EMPTY_DESIGN: finalize_design produced nothing to commit
```
or
```text
NOTHING_SAVED: source wording unchanged
```
wrapped in an outer `AGENT_FAILED` error event.

### Why This Matters:
Naively treating these exits as fatal errors wastes AI credits on redundant design calls and halts automated agent loops. Conversely, blindly ignoring all `AGENT_FAILED` errors would create dangerous false passes.

### Ratchet's Solution:
1. Detects the exact `EMPTY_DESIGN` or `NOTHING_SAVED` error code in the NDJSON stream.
2. Immediately queries Kane's supported, credit-free inspection command:
   ```bash
   kane-cli cover gaps --json
   ```
3. Confirms that the target use case is **100% complete**:
   - `design_completeness.status === "complete"`
   - `designed.criteria === designed.of`
   - `stale_acs === 0`
   - No genuine unresolved design blockers (ignoring post-design verification states like `covered-not-run` or `execution-failed`).
4. If complete, Ratchet safely accepts the idempotent no-op without spending additional credits. If incomplete, it strictly **fails closed** (`exit 1`).

---

## 🔬 Anatomy of a Repair Packet

When verification fails, Ratchet constructs a token-optimized `RepairPacket`. This gives the agent everything needed to fix the defect in a single turn without overwhelming context:

```json
{
  "status": "BLOCKED",
  "locked": false,
  "summary": "Ratchet verification gate blocked (Confirmed Product Defect): The checkout treats SAVE20 as invalid even though this checkout flow requires it to reduce the price from $100 to $80.",
  "evidence": {
    "executionId": "run-20261124-1437",
    "evidencePack": ".testmuai/evidence/run-20261124-1437.zip",
    "replayCommand": "kane-cli evidence serve run-20261124-1437"
  },
  "failureAnalysis": {
    "defectType": "product_defect",
    "isConfirmedProductBug": true,
    "rootCause": "The checkout treats SAVE20 as invalid even though this checkout flow requires it to reduce the price from $100 to $80.",
    "failedStep": 2,
    "memoryDiffs": [
      {
        "check": "visible_total",
        "expected": "$80",
        "actual": "$100"
      }
    ],
    "diagnostics": [
      "The checkout rejects SAVE20 instead of applying the expected discount.",
      "Check promo-code handler in index.html to ensure SAVE20 is recognized."
    ]
  },
  "coverage": {
    "output": "Coverage: 1 / 4 acceptance criteria proven by Kane CLI (25% proven, 4 designed).",
    "totalCriteria": 4,
    "coveredCriteria": 4,
    "provenCriteria": 1
  }
}
```

### Verification Status Codes:
* **`PROVEN` (`locked: true`, `exit 0`):** 100% of acceptance criteria verified and proven in Chrome. Workflow unlocked.
* **`PASSED_BUT_UNPROVEN` (`locked: false`, `exit 1`):** Tests executed without crash, but criteria were unexercised or unproven.
* **`BLOCKED` (`locked: false`, `exit 1`):** Verification failed, manifest modified, or product defect detected.

---

## 💻 CLI Command Reference

### `ratchet init`
Scaffolds `.agents/skills/ratchet/SKILL.md`, creates a starter `PRD.md`, and prints MCP server configuration snippets for your editor.
```bash
node bin/ratchet.js init
```

### `ratchet sync`
Ingests requirements, designs Kane acceptance tests, and writes SHA-256 hashes to `.testmuai/.ratchet_manifest.json`.
```bash
node bin/ratchet.js sync --prd PRD.md
```
*Options:*
* `-p, --prd <path>`: Path to requirement specification (default: `PRD.md`).

### `ratchet verify`
Verifies manifest integrity, runs Kane CLI tests in Chrome, parses streaming NDJSON, and evaluates the gate lock.
```bash
node bin/ratchet.js verify --target .testmuai/tests/check-80-paid-pro-plan-confirmation-after-save20_test.md --json
```
*Options:*
* `-t, --target <path>`: Specific `_test.md` file or scenario.
* `-p, --prd <path>`: Path to PRD for integrity checks (default: `PRD.md`).
* `--json`: Emit machine-readable `RepairPacket` JSON.
* `--no-report`: Skip wrapping execution with `kanehack report`.

### `ratchet hook`
Installs or chains a `.git/hooks/pre-push` gate to prevent unverified code from reaching remote branches.
```bash
node bin/ratchet.js hook
```

---

## 🔌 Model Context Protocol (MCP) Server

Ratchet includes a built-in MCP server over `stdio` (`dist/mcp/server.js`) exposing verification tools directly to Claude Code, Antigravity, Cursor, and Codex:

### Tools Exposed to Agents:
| Tool Name | Parameters | Description |
|---|---|---|
| `ratchet_sync` | `prdPath` (string), `cwd` (string) | Ingests `PRD.md` via Kane CLI assurance workflow and updates manifest |
| `ratchet_verify` | `target` (string), `prdPath` (string), `cwd` (string), `reportProof` (bool) | Validates manifest, executes tests, and returns structured `RepairPacket` |
| `ratchet_coverage` | `cwd` (string) | Inspects current criteria coverage status and identifies outstanding gaps |

### Adding to Agent Configuration:
Run `node bin/ratchet.js init` to generate the exact absolute path configuration block, or add:
```json
{
  "mcpServers": {
    "ratchet": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ratchet/dist/mcp/server.js"]
    }
  }
}
```

---

## 🔒 Git Hook Integration & Tamper Resistance

### Pre-Push Hook:
Running `node bin/ratchet.js hook` installs `.git/hooks/pre-push`:
* Automatically runs `ratchet verify` before any `git push`.
* If existing pre-push hooks are detected, Ratchet chains them safely (saving the original to `pre-push.legacy`), so existing CI/linters continue to run.

### Tamper & Staleness Resistance:
* **Stale PRD Detection:** If `PRD.md` is modified after tests were generated, Ratchet fails closed until `ratchet sync` is re-run.
* **Assertion Tampering Detection:** If an agent attempts to delete failing tests, change assertions, or bypass checks, the SHA-256 hash mismatch immediately triggers `BLOCKED`.
* **CI/CD Recommendation:** While Git hooks protect local workflows, always include `node bin/ratchet.js verify` as a required status check in GitHub Actions for tamper-proof branch protection.

---

## 📄 License

ISC License © 2026. Built with TestMu AI Kane CLI & Model Context Protocol.
