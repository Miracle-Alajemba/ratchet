import fs from "node:fs";
import { KaneExecResult } from "./runner.js";

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

export function buildRepairPacket(
    exec: KaneExecResult,
    coverageInput: string | {
        output: string;
        totalCriteria?: number;
        coveredCriteria?: number;
        provenCriteria?: number;
        gaps?: any[];
    } = "Coverage data unavailable",
    coverageDetails?: {
        totalCriteria?: number;
        coveredCriteria?: number;
        provenCriteria?: number;
        gaps?: any[];
    }
): RepairPacket {
    let coverageOutput: string;
    let details = coverageDetails;

    if (typeof coverageInput === "object" && coverageInput !== null) {
        coverageOutput = coverageInput.output ?? "Coverage data unavailable";
        details = details ?? coverageInput;
    } else {
        coverageOutput = coverageInput;
    }

    const replayCommand = exec.evidencePack
        ? `kane-cli evidence serve ${exec.evidencePack}`
        : exec.executionId
        ? `kane-cli evidence serve ${exec.executionId}`
        : undefined;

    const provenCriteria = details?.provenCriteria ?? 0;
    const totalCriteria = details?.totalCriteria ?? 0;

    // Proof-state consistency guarantee:
    // Ratchet MUST NEVER return PROVEN or locked: true when reported Kane coverage says 0 proven.
    if (exec.passed === true) {
        if (provenCriteria > 0 && (totalCriteria === 0 || provenCriteria >= totalCriteria)) {
            return {
                status: "PROVEN",
                locked: true,
                summary: `All ${provenCriteria} acceptance criteria verified and proven by Kane CLI.`,
                evidence: {
                    executionId: exec.executionId ?? "unavailable",
                    evidencePack: exec.evidencePack ?? "unavailable",
                    replayCommand: replayCommand ?? "unavailable",
                },
                coverage: {
                    output: coverageOutput,
                    totalCriteria: details?.totalCriteria,
                    coveredCriteria: details?.coveredCriteria,
                    provenCriteria,
                    gaps: details?.gaps,
                },
                timestamp: new Date().toISOString(),
            };
        }

        // Distinct state when execution passes mechanically but Kane reports 0 or partial criteria proven
        return {
            status: "PASSED_BUT_UNPROVEN",
            locked: false,
            summary: `Ratchet verification gate unproven: Execution passed but Kane CLI reports ${provenCriteria} of ${totalCriteria} criteria proven (no binding assurance scenarios proven).`,
            evidence: {
                executionId: exec.executionId ?? "unavailable",
                evidencePack: exec.evidencePack ?? "unavailable",
                replayCommand: replayCommand ?? "unavailable",
            },
            coverage: {
                output: coverageOutput,
                totalCriteria: details?.totalCriteria,
                coveredCriteria: details?.coveredCriteria,
                provenCriteria,
                gaps: details?.gaps,
            },
            timestamp: new Date().toISOString(),
        };
    }

    // Now handle failures: Distinguish Product Defects from Test-Execution Failures
    let isConfirmedProductBug = false;
    let rootCause = "unavailable";
    let failedStep: string | number | undefined = undefined;
    let failedMember: string | undefined = undefined;
    const diagnostics: string[] = [];
    const memoryDiffs: MemoryDiff[] = [];

    // First scan events for rich verdict objects from Kane
    for (const evt of exec.events) {
        if (!evt || typeof evt !== "object") continue;

        if (evt.verdict && typeof evt.verdict === "object") {
            const v = evt.verdict;
            if (
                v.confirmed === true ||
                v.family === "application_issue" ||
                v.result_code === 740 ||
                evt.reason_code?.includes("confirmed_product_bug") ||
                evt.result_code === 740
            ) {
                isConfirmedProductBug = true;
            }

            if (v.root_cause && rootCause === "unavailable") {
                rootCause = v.root_cause;
            }
            if (v.one_liner && !diagnostics.includes(v.one_liner)) {
                diagnostics.push(v.one_liner);
            }
            if (v.bug_title && !diagnostics.includes(`Bug: ${v.bug_title}`)) {
                diagnostics.push(`Bug: ${v.bug_title}`);
            }
            if (v.suggestion && !diagnostics.includes(`Suggestion: ${v.suggestion}`)) {
                diagnostics.push(`Suggestion: ${v.suggestion}`);
            }
            if (v.culprit_step && failedStep === undefined) {
                failedStep = v.culprit_step;
            }
            if (Array.isArray(v.signals)) {
                for (const sig of v.signals) {
                    if (sig.excerpt) {
                        const check = sig.kind ? `Signal (${sig.kind})` : "Failure Signal";
                        const exists = memoryDiffs.some((d) => d.check === check && d.actual === sig.excerpt);
                        if (!exists) {
                            memoryDiffs.push({
                                check,
                                expected: "unavailable",
                                actual: sig.excerpt,
                            });
                        }
                    }
                }
            }
        }

        if (evt.type === "test_md_bug_verdict") {
            if (evt.confirmed === true || evt.family === "application_issue") {
                isConfirmedProductBug = true;
            }
            if (evt.one_liner && rootCause === "unavailable") {
                rootCause = evt.one_liner;
            }
            if (evt.bug_title && !diagnostics.includes(`Confirmed Bug: ${evt.bug_title}`)) {
                diagnostics.push(`Confirmed Bug: ${evt.bug_title}`);
            }
            if (evt.step_index !== undefined && failedStep === undefined) {
                failedStep = evt.step_index;
            }
        }
    }

    if (exec.spawnError) {
        rootCause = `Process spawn error: ${exec.spawnError}`;
        diagnostics.push(rootCause);
    } else if (exec.missingCompletion) {
        rootCause = "Missing completion event from Kane CLI";
        diagnostics.push(rootCause);
    } else if (exec.failures.length > 0) {
        const first = exec.failures[0];
        if (rootCause === "unavailable") {
            rootCause =
                first.message ||
                first.failure?.message ||
                "Kane CLI verification failed";
        }

        for (const f of exec.failures) {
            if (f.message && !diagnostics.includes(f.message)) {
                diagnostics.push(f.message);
            }
            if (f.member_id && !failedMember) {
                failedMember = f.member_id;
            }
            if (f.path && !failedMember) {
                failedMember = f.path;
            }
            if (f.failure?.step_index !== undefined && failedStep === undefined) {
                failedStep = f.failure.step_index;
            }
            if (f.step_index !== undefined && failedStep === undefined) {
                failedStep = f.step_index;
            }

            // Extract assertion failures from failure object directly
            extractDiffsFromEvent(f, memoryDiffs);

            // Extract assertion failures from actual Kane log file if present
            if (f.log_path && fs.existsSync(f.log_path)) {
                try {
                    const logContent = fs.readFileSync(f.log_path, "utf8");
                    const lines = logContent.split("\n");
                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (!line || !line.startsWith("{")) continue;
                        try {
                            const evt = JSON.parse(line);
                            extractDiffsFromEvent(evt, memoryDiffs);
                        } catch {
                            // Ignore non-JSON line
                        }
                    }
                } catch {
                    // Ignore file read error
                }
            }
        }
    } else if (exec.exitCode !== 0 && rootCause === "unavailable") {
        rootCause = `Kane CLI process exited with non-zero exit code: ${exec.exitCode}`;
        diagnostics.push(rootCause);
    }

    // Also check stdout parsed events for assertion failures
    for (const evt of exec.events) {
        extractDiffsFromEvent(evt, memoryDiffs);
    }

    const defectType: "product_defect" | "test_execution_failure" = isConfirmedProductBug
        ? "product_defect"
        : "test_execution_failure";

    const summaryPrefix = isConfirmedProductBug
        ? "Ratchet verification gate blocked (Confirmed Product Defect)"
        : "Ratchet verification gate blocked (Test Execution Failure)";

    return {
        status: "BLOCKED",
        locked: false,
        summary: `${summaryPrefix}: ${rootCause}`,
        evidence: {
            executionId: exec.executionId ?? "unavailable",
            evidencePack: exec.evidencePack ?? "unavailable",
            replayCommand: replayCommand ?? "unavailable",
        },
        failureAnalysis: {
            defectType,
            isConfirmedProductBug,
            rootCause,
            failedStep,
            failedMember,
            memoryDiffs,
            diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        },
        coverage: {
            output: coverageOutput,
            totalCriteria: details?.totalCriteria,
            coveredCriteria: details?.coveredCriteria,
            provenCriteria,
            gaps: details?.gaps,
        },
        timestamp: new Date().toISOString(),
    };
}

function extractDiffsFromEvent(evt: any, memoryDiffs: MemoryDiff[]): void {
    if (!evt || typeof evt !== "object") return;

    // Check for Kane assertion events
    const tree = evt.action_params?.assertion_tree || evt.assertion_tree || evt.assertion;
    if (tree && typeof tree === "object") {
        if (tree.passed === false || tree.status === "failed") {
            if (Array.isArray(tree.sub_results)) {
                for (const sub of tree.sub_results) {
                    if (sub.passed === false) {
                        const check = sub.description || tree.description || "unavailable";
                        const expected = sub.expected !== undefined ? sub.expected : "unavailable";
                        const actual =
                            sub.extracted_value !== undefined
                                ? sub.extracted_value
                                : sub.actual !== undefined
                                ? sub.actual
                                : "unavailable";

                        // Avoid exact duplicates
                        const exists = memoryDiffs.some(
                            (d) => d.check === check && d.expected === expected && d.actual === actual
                        );
                        if (!exists) {
                            memoryDiffs.push({ check, expected, actual });
                        }
                    }
                }
            } else if (tree.error_message || tree.description) {
                const check = tree.description || "Assertion check";
                const expected = tree.expected !== undefined ? tree.expected : "unavailable";
                const actual = tree.actual !== undefined ? tree.actual : (tree.error_message || "unavailable");
                const exists = memoryDiffs.some((d) => d.check === check);
                if (!exists) {
                    memoryDiffs.push({ check, expected, actual });
                }
            }
        }
    }

    // Check for member failure event with memory diff details
    if (evt.type === "testrun_member_event" && evt.event) {
        extractDiffsFromEvent(evt.event, memoryDiffs);
    }
}
