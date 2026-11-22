# Ratchet 🔒

**Stop AI coding agents from claiming "Done!" until a real browser proves every requirement works.**

Ratchet is an automated **Spec-to-Verified-Code** gate built on top of **TestMu AI's Kane CLI** and the **Model Context Protocol (MCP)**. It converts plain-English product requirements (`PRD.md`) into binding browser tests, intercepts live test failures, and hands your AI coding agent a structured **Repair Packet** until 100% of acceptance criteria pass in Google Chrome.

---

## Why Ratchet? (The Problem It Solves)

When you ask an AI agent to build a feature, it often writes code that compiles cleanly—and immediately declares victory—even when buttons fail to submit, promo codes miscalculate, or UI states break.

Prompting an agent *"please test this"* isn't enough because:
1. **Agents take shortcuts:** Left unsupervised, an LLM writes one easy "page loads" check and calls it green.
2. **Raw test logs waste context:** Dumping raw browser logs into an agent confuses it instead of pointing to the exact broken behavior.
3. **No hard stop:** Nothing physically blocks broken code from being pushed to Git.

**Ratchet works like a mechanical ratchet wrench:** your codebase can only click forward once Kane CLI proves a requirement works in a real browser, and regressions are locked out.

---

## How It Works (The 4-Step Closed Loop)

```text
  [1. PRD.md] ──▶ ratchet sync ──▶ Kane CLI generates acceptance tests
       ▲                                          │
       │ (Surgical Repair Packet)                 ▼
  [4. AI Agent Patches Code] ◀── [3. NDJSON Stream Parser] ◀── [2. ratchet verify]
```

1. **Ingest Specs (`ratchet sync`):** Reads acceptance criteria from `PRD.md` and generates Kane CLI acceptance scenarios.
2. **Execute Gate (`ratchet verify`):** Kane CLI spins up headless Google Chrome and validates every user action, button click, input, and UI assertion.
3. **Stream Parsing & Repair Packet:** When tests fail, Ratchet filters raw browser telemetry into a token-efficient JSON `RepairPacket` containing root-cause analysis and exact assertion mismatches (`memoryDiffs`).
4. **Self-Healing Loop:** The agent uses the `RepairPacket` to patch the implementation (without touching or weakening test assertions) and re-runs `ratchet verify` until `locked: true`.

---

## The Repair Packet Contract

When verification fails, `ratchet verify --json` exits with code `1` and emits a structured `RepairPacket`:

```json
{
  "status": "BLOCKED",
  "locked": false,
  "summary": "Ratchet verification gate blocked: AP determined agent is stuck — no viable actions remain",
  "evidence": {
    "executionId": "cce2a7d0-b1e2-4f45-9e2a-74cf83cc3a26",
    "evidencePack": "demo-app/.testmuai/evidence/cce2a7d0-b1e2-4f45-9e2a-74cf83cc3a26.evidence",
    "replayCommand": "kane-cli evidence serve demo-app/.testmuai/evidence/cce2a7d0-b1e2-4f45-9e2a-74cf83cc3a26.evidence"
  },
  "failureAnalysis": {
    "rootCause": "Promo code SAVE20 was not applied to update total to $80",
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
  },
  "timestamp": "2026-11-22T15:58:40.600Z"
}
```

Once all criteria are verified, Ratchet locks:

```json
{
  "status": "PROVEN",
  "locked": true,
  "summary": "All acceptance criteria verified and proven by Kane CLI.",
  "evidence": {
    "executionId": "1f053511-38d8-40f7-865f-44957fb033a4",
    "evidencePack": "demo-app/.testmuai/evidence/1f053511-38d8-40f7-865f-44957fb033a4.evidence",
    "replayCommand": "kane-cli evidence serve demo-app/.testmuai/evidence/1f053511-38d8-40f7-865f-44957fb033a4.evidence"
  },
  "coverage": {
    "output": "Coverage: 3 / 3 acceptance criteria mapped to Kane CLI scenarios (100%)."
  },
  "timestamp": "2026-11-22T16:21:04.082Z"
}
```

---

## Installation & Setup

### Prerequisites
- Node.js >= 18
- Google Chrome or Chromium installed
- `@testmuai/kane-cli` installed and authenticated (`npm install -g @testmuai/kane-cli@rc`)

### Install Ratchet
```bash
git clone https://github.com/Miracle-Alajemba/ratchet.git
cd ratchet
npm install
npm link
```

---

## CLI Usage

### 1. Initialize Ratchet in any project
```bash
ratchet init
```
Scaffolds `.agents/skills/ratchet/SKILL.md`, a template `PRD.md`, and prints MCP config.

### 2. Sync Specs to Acceptance Scenarios
```bash
ratchet sync --prd PRD.md
```
Ingests requirement criteria and compiles Kane CLI markdown scenarios into `.testmuai/tests/checkout_test.md`.

### 3. Verify & Enforce Lock Gate
```bash
# Terminal view with formatted CLI output:
ratchet verify

# Machine-readable JSON output for AI agent self-healing loops:
ratchet verify --no-report --json

# Target a specific test flow:
ratchet verify -t checkout_test.md
```

### 4. Git Pre-Push Gate
```bash
ratchet hook
```
Installs `.git/hooks/pre-push`. Prevents developers and autonomous agents from pushing commits unless `ratchet verify` passes.

---

## Model Context Protocol (MCP) Integration

Ratchet includes an official MCP server enabling Claude Code, Cursor, Codex, and Antigravity agents to control the verification loop natively.

### Configure in MCP Settings
Add to your MCP configuration (`~/.gemini/config/mcp_config.json`, `claude_desktop_config.json`, etc.):

```json
{
  "mcpServers": {
    "ratchet": {
      "command": "node",
      "args": ["/path/to/ratchet/bin/ratchet.js", "mcp"]
    }
  }
}
```

### Exposed MCP Tools:
- **`ratchet_sync`**: Ingests `PRD.md`, checks requirement coverage, and generates binding Kane CLI tests.
- **`ratchet_verify`**: Executes Kane CLI in headless Chrome and returns the `RepairPacket`.
- **`ratchet_coverage`**: Reports current requirement coverage and owed criteria.

---

## Live Demo Walkthrough (`demo-app/`)

Inside `demo-app/`, we executed a complete closed loop:
1. Created `demo-app/PRD.md` with 3 acceptance criteria for a Pro Plan Checkout page ($100 base price, `SAVE20` promo reduces total to $80, Order confirmation).
2. Built `demo-app/index.html` with an intentional discount failure bug.
3. Started static server on port 4173 (`npx serve demo-app -l 4173`).
4. Ran `ratchet sync --prd PRD.md` to design scenarios.
5. Ran `ratchet verify --no-report --json`: blocked with `locked: false` and returned surgical repair diff.
6. Fixed `demo-app/index.html` and re-ran `ratchet verify`: returned `locked: true` (`PROVEN`).

---

## License

ISC License. Built for TestMu AI's Kane CLI Hackathon.
