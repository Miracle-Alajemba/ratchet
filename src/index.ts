#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { syncSpecWithKane, getCoverageStatus, detectStaleOrAltered } from "./engine/spec.js";
import { executeKaneCommand } from "./engine/runner.js";
import { buildRepairPacket } from "./engine/packet.js";
import { installPrePushHook } from "./engine/hook.js";

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
        console.log(chalk.blue(`⚙ Syncing spec from ${opts.prd} via Kane CLI assurance workflow...`));
        try {
            const res = syncSpecWithKane(opts.prd, process.cwd());
            console.log(chalk.green(`✔ Kane context ingested & acceptance tests designed.`));
            console.log(chalk.gray(`  PRD Path: ${res.prdPath}`));
            console.log(chalk.gray(`  Generated test files: ${res.testFiles.join(", ") || "none"}`));

            console.log(chalk.cyan("\nAcceptance Criteria to Kane Tests Mapping:"));
            for (const c of res.criteria) {
                if (c.status === "MAPPED") {
                    console.log(`  ${chalk.green("✔")} [${c.id}] ${c.text}`);
                    console.log(`      ↳ Test: ${c.testId || "unknown"} in ${c.testFile || "unknown"}`);
                } else {
                    console.log(`  ${chalk.red("✖ GAP")} [${c.id}] ${c.text}`);
                    console.log(`      ↳ Reason: ${c.gapReason || "Missing test scenario"}`);
                }
            }

            console.log(`\n${chalk.bold(res.coverage.output)}`);
            if (res.coverage.gapsCount > 0) {
                console.log(chalk.yellow(`⚠ Warning: ${res.coverage.gapsCount} criterion/criteria have gaps or missing tests.`));
            }
        } catch (err) {
            console.error(chalk.red(`\n✖ Kane CLI assurance workflow failed:`));
            console.error(chalk.red(`  ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    });

program
    .command("verify")
    .description("Run Kane CLI verification and enforce the Ratchet lock")
    .option("-p, --prd <path>", "Path to PRD.md", "PRD.md")
    .option("-t, --target <target>", "Specific _test.md file or plain-English flow")
    .option("--no-report", "Skip kanehack report wrapper")
    .option("--json", "Output raw Repair Packet JSON")
    .action(async (opts) => {
        if (!opts.json) {
            console.log(chalk.blue("🔒 Running Ratchet verification gate via Kane CLI..."));
        }

        // 1. Detect stale or altered generated tests before verification
        const integrity = detectStaleOrAltered(process.cwd(), opts.prd);
        if (!integrity.ok) {
            const blockedPacket = {
                status: "BLOCKED" as const,
                locked: false,
                summary: `Ratchet verification gate blocked: ${integrity.reason}`,
                evidence: {
                    executionId: "unavailable",
                    evidencePack: "unavailable",
                    replayCommand: "unavailable",
                },
                failureAnalysis: {
                    rootCause: integrity.reason || "Integrity verification failure",
                    memoryDiffs: [],
                    diagnostics: [integrity.reason || "Stale or altered tests detected"],
                },
                coverage: {
                    output: "Integrity check failed before test execution",
                },
                timestamp: new Date().toISOString(),
            };

            if (opts.json) {
                console.log(JSON.stringify(blockedPacket, null, 2));
            } else {
                console.error(chalk.red.bold("\n✖ RATCHET BLOCKED — INTEGRITY CHECK FAILED"));
                console.error(chalk.yellow(`  ${integrity.reason}`));
            }
            process.exit(1);
        }

        const kaneArgs = opts.target
            ? opts.target.endsWith(".md")
                ? ["testmd", "run", opts.target, "--agent"]
                : ["run", opts.target, "--agent"]
            : ["testrun", "run", "--agent"];

        const exec = await executeKaneCommand(kaneArgs, process.cwd(), opts.report);
        const coverage = getCoverageStatus(process.cwd());
        const packet = buildRepairPacket(exec, coverage.output, coverage);

        if (opts.json) {
            console.log(JSON.stringify(packet, null, 2));
            process.exit(packet.locked ? 0 : 1);
        }

        if (packet.locked) {
            console.log(chalk.green.bold("\n✔ RATCHET LOCKED — ALL ACCEPTANCE CRITERIA PROVEN"));
            console.log(chalk.gray(`  Summary: ${packet.summary}`));
            if (packet.evidence.replayCommand && packet.evidence.replayCommand !== "unavailable") {
                console.log(chalk.cyan(`  Evidence Replay: ${packet.evidence.replayCommand}`));
            }
            process.exit(0);
        } else if (packet.status === "PASSED_BUT_UNPROVEN") {
            console.log(chalk.yellow.bold("\n⚠ RATCHET UNPROVEN — EXECUTION PASSED BUT NO CRITERIA PROVEN"));
            console.log(chalk.yellow(`  Summary: ${packet.summary}`));
            console.log(chalk.gray(`  Coverage: ${packet.coverage?.output}`));
            if (packet.evidence.replayCommand && packet.evidence.replayCommand !== "unavailable") {
                console.log(chalk.cyan(`  Evidence Replay: ${packet.evidence.replayCommand}`));
            }
            process.exit(1);
        } else {
            console.log(chalk.red.bold("\n✖ RATCHET BLOCKED — VERIFICATION FAILED"));
            console.log(chalk.yellow(`  Summary: ${packet.summary}`));
            if (packet.failureAnalysis?.rootCause && packet.failureAnalysis.rootCause !== "unavailable") {
                console.log(chalk.white(`  Root Cause: ${packet.failureAnalysis.rootCause}`));
            }
            if (packet.failureAnalysis?.memoryDiffs && packet.failureAnalysis.memoryDiffs.length > 0) {
                console.log(chalk.magenta("  Assertion Mismatches:"));
                for (const diff of packet.failureAnalysis.memoryDiffs) {
                    console.log(`    - ${diff.check}: expected ${JSON.stringify(diff.expected)}, got ${JSON.stringify(diff.actual)}`);
                }
            }
            if (packet.evidence.replayCommand && packet.evidence.replayCommand !== "unavailable") {
                console.log(chalk.cyan(`  Replay Failure: ${packet.evidence.replayCommand}`));
            }
            process.exit(1);
        }
    });

program
    .command("hook")
    .description("Install a Git pre-push hook that blocks unverified pushes")
    .action(() => {
        try {
            const res = installPrePushHook(process.cwd());
            console.log(chalk.green(`✔ ${res.message}`));
            if (res.chained && res.legacyPath) {
                console.log(chalk.cyan(`  Chained existing hook preserved at ${res.legacyPath}`));
            }
            console.log(chalk.yellow("\nNote: Local git hooks are client-side safeguards and can be bypassed (e.g. git push --no-verify)."));
            console.log(chalk.yellow("For tamper-proof verification, enforce 'ratchet verify' in your CI/CD pipeline."));
        } catch (err) {
            console.error(chalk.red(`Failed to install pre-push hook: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    });

program.parse();
