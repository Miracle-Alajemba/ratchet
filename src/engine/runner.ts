import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface KaneExecResult {
    command: string;
    args: string[];
    exitCode: number;
    passed: boolean;
    stdout: string;
    stderr: string;
    events: any[];
    commandSurface: "testrun" | "testmd" | "run" | "generic";
    executionId?: string;
    evidencePack?: string;
    summary?: any;
    failures: any[];
    completionEvent?: any;
    missingCompletion?: boolean;
    spawnError?: string;
}

export function findKaneBinary(): string {
    const home = os.homedir();
    const candidates = [
        "kane-cli",
        path.join(home, ".local", "bin", "kane-cli"),
        path.join(home, ".npm-global", "bin", "kane-cli"),
    ];

    for (const bin of candidates) {
        if (bin === "kane-cli") return bin;
        if (fs.existsSync(bin)) return bin;
    }
    return "kane-cli";
}

export function createNdjsonParser() {
    let buffer = "";

    function feed(chunk: string): any[] {
        buffer += chunk;
        const lines = buffer.split("\n");
        // The last element is whatever trailing text is not followed by a newline yet
        buffer = lines.pop() ?? "";

        const events: any[] = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            // Attempt to parse JSON; if malformed or non-JSON log line, silently ignore
            if (line.startsWith("{") && line.endsWith("}")) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed && typeof parsed === "object") {
                        events.push(parsed);
                    }
                } catch {
                    // Ignore malformed JSON line
                }
            }
        }
        return events;
    }

    function flush(): any[] {
        const events: any[] = [];
        const line = buffer.trim();
        buffer = "";
        if (line && line.startsWith("{") && line.endsWith("}")) {
            try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed === "object") {
                    events.push(parsed);
                }
            } catch {
                // Ignore malformed line
            }
        }
        return events;
    }

    return { feed, flush };
}

export function determineCommandSurface(args: string[]): "testrun" | "testmd" | "run" | "generic" {
    if (args.length === 0) return "testrun";
    if (args.includes("testmd")) return "testmd";
    if (args.includes("testrun")) return "testrun";
    if (args.includes("run")) return "run";
    const sub = args[0];
    if (sub === "testrun") return "testrun";
    if (sub === "testmd") return "testmd";
    if (sub === "run") return "run";
    return "generic";
}

export function evaluateRunResult(
    surface: "testrun" | "testmd" | "run" | "generic",
    events: any[],
    exitCode: number | null | undefined,
    spawnError?: string
): {
    passed: boolean;
    failures: any[];
    completionEvent?: any;
    missingCompletion: boolean;
    executionId?: string;
    evidencePack?: string;
    summary?: any;
} {
    const failures: any[] = [];
    let completionEvent: any = undefined;
    let executionId: string | undefined = undefined;
    let evidencePack: string | undefined = undefined;
    let summary: any = undefined;

    if (spawnError) {
        return {
            passed: false,
            failures: [{ message: `Process spawn error: ${spawnError}` }],
            missingCompletion: true,
        };
    }

    if (exitCode !== 0) {
        failures.push({ message: `Kane CLI process exited with non-zero code: ${exitCode}` });
    }

    for (const event of events) {
        if (!event || typeof event !== "object") continue;

        if (event.execution_id) executionId = event.execution_id;
        if (event.execution?.id) executionId = event.execution.id;
        if (event.session_id && !executionId) executionId = event.session_id;
        if (event.pack) evidencePack = event.pack;
        if (event.evidence_id) evidencePack = event.evidence_id;

        if (surface === "testrun") {
            if (event.type === "testrun_summary") {
                summary = event;
                if (event.totals?.failed > 0 || event.totals?.broken > 0) {
                    failures.push({
                        message: `Testrun summary reported failures: ${event.totals?.failed ?? 0} failed, ${event.totals?.broken ?? 0} broken`,
                        summary: event,
                    });
                }
            }

            if (
                event.type === "testrun_member_end" ||
                event.type === "testrun_authored_member_end"
            ) {
                if (event.status && event.status !== "passed") {
                    failures.push({
                        type: "member_failure",
                        member_id: event.member_id,
                        status: event.status,
                        failure: event.failure,
                        log_path: event.log_path,
                        path: event.path,
                        message: event.failure?.message || `Member ${event.member_id || event.path} finished with status '${event.status}'`,
                    });
                }
            }

            if (event.type === "testrun_done") {
                completionEvent = event;
                if (event.overall_status !== "passed") {
                    failures.push({
                        type: "testrun_done_failure",
                        overall_status: event.overall_status,
                        message: `testrun completed with overall status: ${event.overall_status}`,
                        ...event,
                    });
                }
            }
        } else if (surface === "testmd") {
            // Official completion event for testmd: test_md_done
            if (event.type === "test_md_done" || event.event === "test_md_done") {
                completionEvent = event;
                if (event.overall_status !== "passed") {
                    failures.push({
                        ...event,
                        type: "testmd_done_failure",
                        overall_status: event.overall_status,
                        message: `testmd completed with overall status: ${event.overall_status || "unknown"}`,
                    });
                }
            }

            if (event.type === "test_md_summary") {
                summary = event;
                if (event.overall_status && event.overall_status !== "passed") {
                    failures.push({
                        ...event,
                        type: "testmd_summary_failure",
                        overall_status: event.overall_status,
                        message: `testmd summary reported status '${event.overall_status}' (steps: ${event.steps?.failed ?? 0} failed)`,
                    });
                }
            }

            if (event.type === "test_md_bug_verdict") {
                if (event.confirmed) {
                    failures.push({
                        ...event,
                        type: "testmd_bug_verdict",
                        step_index: event.step_index,
                        message: event.one_liner || event.bug_title || "Confirmed product bug in testmd",
                    });
                }
            }

            if (event.type === "test_md_step_end") {
                if (event.status && event.status !== "passed") {
                    failures.push({
                        ...event,
                        type: "testmd_step_failure",
                        step_index: event.step_index,
                        message: `testmd step ${event.step_index} failed`,
                    });
                }
            }
        } else if (surface === "run") {
            // Official completion event for run: run_end
            if (event.type === "run_end" || event.event === "run_end") {
                completionEvent = event;
                if (event.status && event.status !== "passed") {
                    failures.push({
                        type: "run_failure",
                        message: event.reason || event.verdict?.root_cause || `Objective run finished with status '${event.status}'`,
                        ...event,
                    });
                }
            }
        } else {
            if (
                event.type === "testrun_done" ||
                event.type === "test_md_done" ||
                event.type === "run_end" ||
                event.type?.endsWith("_done") ||
                event.event?.endsWith("_done")
            ) {
                completionEvent = event;
            }
        }
    }

    const missingCompletion = !completionEvent;
    if (missingCompletion) {
        const expectedName =
            surface === "testrun"
                ? "testrun_done"
                : surface === "testmd"
                ? "test_md_done"
                : surface === "run"
                ? "run_end"
                : "completion event";
        failures.push({
            message: `Missing completion event from Kane CLI (expected '${expectedName}' for surface '${surface}').`,
        });
    }

    // Fail-closed requirement:
    // Any failure, missing completion, or non-zero exit code means passed = false
    const passed =
        exitCode === 0 &&
        !missingCompletion &&
        failures.length === 0;

    return {
        passed,
        failures,
        completionEvent,
        missingCompletion,
        executionId,
        evidencePack,
        summary,
    };
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
            const kanehack = path.join(os.homedir(), ".local", "bin", "kanehack");
            if (fs.existsSync(kanehack)) {
                cmd = kanehack;
                args = ["report", "--", bin, ...kaneArgs];
            }
        }

        const home = os.homedir();
        const localBin = path.join(home, ".local", "bin");
        const npmBin = path.join(home, ".npm-global", "bin");

        const child = spawn(cmd, args, {
            cwd: workdir,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:${localBin}:${npmBin}`,
            },
        });

        const parser = createNdjsonParser();
        const events: any[] = [];
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer | string) => {
            const str = chunk.toString();
            stdout += str;
            const parsedEvents = parser.feed(str);
            events.push(...parsedEvents);
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on("close", (code) => {
            const flushed = parser.flush();
            events.push(...flushed);

            const surface = determineCommandSurface(kaneArgs);
            const evaluation = evaluateRunResult(surface, events, code);

            resolve({
                command: `${cmd} ${args.join(" ")}`,
                args,
                exitCode: code ?? 1,
                passed: evaluation.passed,
                stdout,
                stderr,
                events,
                commandSurface: surface,
                executionId: evaluation.executionId,
                evidencePack: evaluation.evidencePack,
                summary: evaluation.summary,
                failures: evaluation.failures,
                completionEvent: evaluation.completionEvent,
                missingCompletion: evaluation.missingCompletion,
            });
        });

        child.on("error", (err) => {
            const surface = determineCommandSurface(kaneArgs);
            const evaluation = evaluateRunResult(surface, [], null, err.message);

            resolve({
                command: `${cmd} ${args.join(" ")}`,
                args,
                exitCode: 1,
                passed: false,
                stdout,
                stderr: err.message,
                events: [],
                commandSurface: surface,
                failures: evaluation.failures,
                missingCompletion: true,
                spawnError: err.message,
            });
        });
    });
}
