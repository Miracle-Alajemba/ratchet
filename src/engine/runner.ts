import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface KaneExecResult {
    command: string;
    args: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
    events: any[];
    executionId?: string;
    evidencePack?: string;
    summary?: any;
    failures: any[];
}

export function findKaneBinary(): string {
    const candidates = [
        "kane-cli",
        "/home/miracle-alajemba/.local/bin/kane-cli",
        "/home/miracle-alajemba/.npm-global/bin/kane-cli",
    ];

    for (const bin of candidates) {
        if (bin === "kane-cli") return bin;
        if (fs.existsSync(bin)) return bin;
    }
    return "kane-cli";
}

export function executeKaneCommand(
    kaneArgs: string[],
    workdir: string = process.cwd(),
    reportProof: boolean = false
): Promise<KaneExecResult> {
    return new Promise((resolve) => {
        const bin = findKaneBinary();
        let cmd = bin;
        let args = [...kaneArgs];

        if (reportProof) {
            const kanehack = "/home/miracle-alajemba/.local/bin/kanehack";
            if (fs.existsSync(kanehack)) {
                cmd = kanehack;
                args = ["report", "--", bin, ...kaneArgs];
            }
        }

        const child = spawn(cmd, args, {
            cwd: workdir,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:/home/miracle-alajemba/.local/bin:/home/miracle-alajemba/.npm-global/bin`,
            },
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("close", (exitCode) => {
            const events: any[] = [];
            const failures: any[] = [];
            let executionId: string | undefined;
            let evidencePack: string | undefined;
            let summary: any;

            const lines = stdout.split("\n");
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        events.push(parsed);

                        if (parsed.execution_id) {
                            executionId = parsed.execution_id;
                        }
                        if (parsed.execution?.id) {
                            executionId = parsed.execution.id;
                        }
                        if (parsed.pack) {
                            evidencePack = parsed.pack;
                        }
                        if (parsed.evidence_id) {
                            evidencePack = parsed.evidence_id;
                        }
                        if (parsed.type === "testrun_summary") {
                            summary = parsed;
                            if (parsed.totals?.failed > 0 && failures.length === 0) {
                                failures.push({ message: `${parsed.totals.failed} test(s) failed` });
                            }
                        }
                        if ((parsed.type === "testrun_authored_member_end" || parsed.type === "testrun_member_end") && parsed.status === "failed") {
                            failures.push(parsed);
                        }
                        if (parsed.type === "testrun_done" && parsed.overall_status === "failed" && failures.length === 0) {
                            failures.push({ message: "testrun completed with overall status: failed", ...parsed });
                        }
                    } catch {}
                }
            }

            resolve({
                command: `${cmd} ${args.join(" ")}`,
                args,
                exitCode: exitCode ?? 0,
                stdout,
                stderr,
                events,
                executionId,
                evidencePack,
                summary,
                failures,
            });
        });

        child.on("error", (err) => {
            resolve({
                command: `${cmd} ${args.join(" ")}`,
                args,
                exitCode: 1,
                stdout,
                stderr: err.message,
                events: [],
                failures: [{ message: err.message }],
            });
        });
    });
}
