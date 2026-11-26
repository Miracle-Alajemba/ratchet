#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { syncSpecWithKane, getCoverageStatus, detectStaleOrAltered, markManifestCriteriaProven, RatchetManifest } from "../engine/spec.js";
import { executeKaneCommand, KaneExecResult } from "../engine/runner.js";
import { buildRepairPacket } from "../engine/packet.js";

const server = new McpServer({
    name: "ratchet",
    version: "0.1.0",
});

server.tool(
    "ratchet_sync",
    "Ingest a PRD.md file into Kane CLI, generate binding acceptance tests, and check owed requirement coverage.",
    {
        prdPath: z.string().default("PRD.md").describe("Path to the PRD markdown file"),
        cwd: z.string().optional().describe("Project working directory"),
    },
    async ({ prdPath, cwd }) => {
        const workdir = cwd || process.cwd();
        try {
            const result = syncSpecWithKane(prdPath, workdir);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } catch (err) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Failed to sync spec via Kane CLI: ${err instanceof Error ? err.message : String(err)}`,
                    },
                ],
            };
        }
    }
);

server.tool(
    "ratchet_verify",
    "Execute Kane CLI acceptance tests against the running app and return a surgical Repair Packet or PROVEN lock.",
    {
        prdPath: z.string().default("PRD.md").describe("Path to the PRD markdown file"),
        target: z
            .string()
            .optional()
            .describe("Optional specific _test.md file or plain-English flow; defaults to full testrun"),
        cwd: z.string().optional().describe("Project working directory"),
        reportProof: z
            .boolean()
            .default(true)
            .describe("Wrap execution with kanehack report to log hackathon proof"),
    },
    async ({ prdPath, target, cwd, reportProof }) => {
        const workdir = cwd || process.cwd();

        // 1. Detect stale or altered generated tests before verification
        const integrity = detectStaleOrAltered(workdir, prdPath);
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

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(blockedPacket, null, 2),
                    },
                ],
            };
        }

        const manifestPath = path.join(workdir, ".testmuai", ".ratchet_manifest.json");
        let manifest: RatchetManifest | null = null;
        if (fs.existsSync(manifestPath)) {
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            } catch {}
        }

        let exec: KaneExecResult;
        const passedTestFiles: string[] = [];

        if (target) {
            const kaneArgs = target.endsWith(".md")
                ? ["testmd", "run", target, "--agent"]
                : ["run", target, "--agent"];
            exec = await executeKaneCommand(kaneArgs, workdir, reportProof);
            if (exec.passed && exec.exitCode === 0) {
                passedTestFiles.push(target);
            }
        } else if (manifest && manifest.testFiles && Object.keys(manifest.testFiles).length > 0) {
            const syncedTestFiles = Object.keys(manifest.testFiles);
            let lastExec: KaneExecResult | null = null;

            for (const testFile of syncedTestFiles) {
                const curExec = await executeKaneCommand(["testmd", "run", testFile, "--agent"], workdir, reportProof);
                lastExec = curExec;
                if (!curExec.passed || curExec.exitCode !== 0) {
                    break;
                }
                passedTestFiles.push(testFile);
            }
            exec = lastExec!;
        } else {
            exec = await executeKaneCommand(["testrun", "run", "--agent"], workdir, reportProof);
        }

        if (exec.passed && exec.exitCode === 0) {
            markManifestCriteriaProven(workdir, passedTestFiles);
        }

        const coverage = getCoverageStatus(workdir, prdPath);
        const packet = buildRepairPacket(exec, coverage.output, coverage);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(packet, null, 2),
                },
            ],
        };
    }
);

server.tool(
    "ratchet_coverage",
    "Check current Kane CLI requirement coverage and owed acceptance criteria.",
    {
        cwd: z.string().optional().describe("Project working directory"),
    },
    async ({ cwd }) => {
        const workdir = cwd || process.cwd();
        const coverage = getCoverageStatus(workdir);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(coverage, null, 2),
                },
            ],
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error("Ratchet MCP server error:", err);
    process.exit(1);
});
