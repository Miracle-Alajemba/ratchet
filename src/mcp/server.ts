#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { syncSpecWithKane, getCoverageStatus } from "../engine/spec.js";
import { executeKaneCommand } from "../engine/runner.js";
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
                        text: `Failed to sync spec: ${err instanceof Error ? err.message : String(err)}`,
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
    async ({ target, cwd, reportProof }) => {
        const workdir = cwd || process.cwd();

        const kaneArgs = target
            ? target.endsWith(".md")
                ? ["testmd", "run", target, "--agent"]
                : ["run", target, "--agent"]
            : ["testrun", "run", "--agent"];

        const exec = await executeKaneCommand(kaneArgs, workdir, reportProof);
        const coverage = getCoverageStatus(workdir);
        const packet = buildRepairPacket(exec, coverage.output);

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