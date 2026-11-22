#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { syncSpecWithKane, getCoverageStatus } from "./engine/spec.js";
import { executeKaneCommand } from "./engine/runner.js";
import { buildRepairPacket } from "./engine/packet.js";

const program = new Command();

program
    .name("ratchet")
    .description("Spec-to-Verified-Code state machine powered by Kane CLI and MCP")
    .version("0.1.0");

program
    .command("init")
    .description("Scaffold Antigravity SKILL.md, sample PRD.md, and print MCP config")
    .action(() => {
        const cwd = process.cwd();
        const skillDir = path.join(cwd, ".agents", "skills", "ratchet");
        fs.mkdirSync(skillDir, { recursive: true });

        const skillContent = `---
name: ratchet
description: Enforce spec-to-verified-code loops using Kane CLI. Use whenever implementing features from PRD.md, verifying UI behavior, or fixing failing acceptance tests.
---

# Ratchet — Spec-to-Verified-Code Protocol

Never declare a feature "done" based solely on code compilation or unit tests.

## Mandatory Loop
1. **Sync Specs:** Call \`ratchet_sync\` (or \`npx ratchet sync\`) whenever \`PRD.md\` is created or modified.
2. **Implement:** Write or update application code to satisfy the owed acceptance criteria.
3. **Verify & Lock:** Call \`ratchet_verify\` (or \`npx ratchet verify\`).
4. **Self-Heal on Failure:** If \`ratchet_verify\` returns \`status: "BLOCKED"\`, inspect \`failureAnalysis\` and \`memoryDiffs\`, patch the app code (do NOT weaken test assertions), and re-run \`ratchet_verify\`.
5. **Completion Gate:** Only report completion when \`locked: true\`.
`;

        fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent, "utf8");

        const prdPath = path.join(cwd, "PRD.md");
        if (!fs.existsSync(prdPath)) {
            fs.writeFileSync(
                prdPath,
                `# Product Requirements Document\n\n## Story 1: User Authentication\n- Given a user visits the login page at http://localhost:3000\n- When they submit valid credentials\n- Then they are redirected to the dashboard and see a welcome banner\n`,
                "utf8"
            );
        }

        const mcpServerPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "mcp/server.js");

        console.log(chalk.green("✔ Ratchet initialized!"));
        console.log(chalk.cyan("  • Created .agents/skills/ratchet/SKILL.md"));
        console.log(chalk.cyan("  • Checked PRD.md"));
        console.log(chalk.yellow("\nAdd this to your Antigravity MCP config (~/.gemini/config/mcp_config.json):"));
        console.log(
            JSON.stringify(
                {
                    mcpServers: {
                        ratchet: {
                            command: "node",
                            args: [mcpServerPath],
                        },
                    },
                },
                null,
                2
            )
        );
    });

program
    .command("sync")
    .description("Ingest PRD.md and generate binding Kane CLI acceptance tests")
    .option("-p, --prd <path>", "Path to PRD.md", "PRD.md")
    .action((opts) => {
        console.log(chalk.blue(`⚙ Syncing spec from ${opts.prd}...`));
        const res = syncSpecWithKane(opts.prd);
        console.log(chalk.green("✔ Context ingested & acceptance tests designed."));
        console.log(res.cover.output);
    });

program
    .command("verify")
    .description("Run Kane CLI verification and enforce the Ratchet lock")
    .option("-t, --target <target>", "Specific _test.md file or plain-English flow")
    .option("--no-report", "Skip kanehack report wrapper")
    .option("--json", "Output raw Repair Packet JSON")
    .action(async (opts) => {
        if (!opts.json) {
            console.log(chalk.blue("🔒 Running Ratchet verification gate via Kane CLI..."));
        }

        const kaneArgs = opts.target
            ? opts.target.endsWith(".md")
                ? ["testmd", "run", opts.target, "--agent"]
                : ["run", opts.target, "--agent"]
            : ["testrun", "run", "--agent"];

        const exec = await executeKaneCommand(kaneArgs, process.cwd(), opts.report);
        const coverage = getCoverageStatus(process.cwd());
        const packet = buildRepairPacket(exec, coverage.output);

        if (opts.json) {
            console.log(JSON.stringify(packet, null, 2));
            process.exit(packet.locked ? 0 : 1);
        }

        if (packet.locked) {
            console.log(chalk.green.bold("\n✔ RATCHET LOCKED — ALL ACCEPTANCE CRITERIA PROVEN"));
            console.log(chalk.gray(`  Summary: ${packet.summary}`));
            if (packet.evidence.replayCommand) {
                console.log(chalk.cyan(`  Evidence Replay: ${packet.evidence.replayCommand}`));
            }
            process.exit(0);
        } else {
            console.log(chalk.red.bold("\n✖ RATCHET BLOCKED — VERIFICATION FAILED"));
            console.log(chalk.yellow(`  Summary: ${packet.summary}`));
            if (packet.failureAnalysis?.rootCause) {
                console.log(chalk.white(`  Root Cause: ${packet.failureAnalysis.rootCause}`));
            }
            if (packet.failureAnalysis?.memoryDiffs.length) {
                console.log(chalk.magenta("  Assertion Mismatches:"));
                for (const diff of packet.failureAnalysis.memoryDiffs) {
                    console.log(`    - ${diff.check}: expected ${JSON.stringify(diff.expected)}, got ${JSON.stringify(diff.actual)}`);
                }
            }
            if (packet.evidence.replayCommand) {
                console.log(chalk.cyan(`  Replay Failure: ${packet.evidence.replayCommand}`));
            }
            process.exit(1);
        }
    });

program
    .command("hook")
    .description("Install a Git pre-push hook that blocks unverified pushes")
    .action(() => {
        const gitHooksDir = path.join(process.cwd(), ".git", "hooks");
        if (!fs.existsSync(gitHooksDir)) {
            console.error(chalk.red("Not a git repository."));
            process.exit(1);
        }
        const hookPath = path.join(gitHooksDir, "pre-push");
        const script = `#!/bin/sh\necho "🔒 Ratchet Pre-Push Gate: verifying acceptance criteria..."\nnpx ratchet verify\n`;
        fs.writeFileSync(hookPath, script, { mode: 0o755 });
        console.log(chalk.green("✔ Installed .git/hooks/pre-push Ratchet gate!"));
    });

program.parse();