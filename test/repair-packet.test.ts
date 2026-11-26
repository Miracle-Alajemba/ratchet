import test from "node:test";
import assert from "node:assert";
import { buildRepairPacket } from "../src/engine/packet.js";
import { KaneExecResult } from "../src/engine/runner.js";

test("buildRepairPacket returns PROVEN and locked=true when run passed and criteria are proven", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testrun run --agent",
        args: ["testrun", "run", "--agent"],
        exitCode: 0,
        passed: true,
        stdout: "",
        stderr: "",
        events: [],
        commandSurface: "testrun",
        executionId: "exec-999",
        evidencePack: ".testmuai/evidence/exec-999.evidence",
        failures: [],
    };

    const packet = buildRepairPacket(exec, "Coverage: 3 / 3 criteria proven (100%)", {
        totalCriteria: 3,
        coveredCriteria: 3,
        provenCriteria: 3,
    });
    assert.strictEqual(packet.status, "PROVEN");
    assert.strictEqual(packet.locked, true);
    assert.strictEqual(packet.evidence.executionId, "exec-999");
    assert.strictEqual(packet.evidence.evidencePack, ".testmuai/evidence/exec-999.evidence");
    assert.strictEqual(packet.evidence.replayCommand, "kane-cli evidence serve .testmuai/evidence/exec-999.evidence");
});

test("buildRepairPacket returns PASSED_BUT_UNPROVEN and locked=false when run passed but 0 criteria proven", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testrun run --agent",
        args: ["testrun", "run", "--agent"],
        exitCode: 0,
        passed: true,
        stdout: "",
        stderr: "",
        events: [],
        commandSurface: "testrun",
        executionId: "exec-unproven",
        failures: [],
    };

    const packet = buildRepairPacket(exec, "Coverage: 0 / 3 criteria proven (0% proven)", {
        totalCriteria: 3,
        coveredCriteria: 3,
        provenCriteria: 0,
    });
    assert.strictEqual(packet.status, "PASSED_BUT_UNPROVEN");
    assert.strictEqual(packet.locked, false);
    assert.strictEqual(
        packet.summary,
        "Ratchet verification gate unproven: Execution passed but Kane CLI reports 0 of 3 criteria proven (no binding assurance scenarios proven)."
    );
});

test("buildRepairPacket omits unproven suffix when 0 < provenCriteria < totalCriteria", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testrun run --agent",
        args: ["testrun", "run", "--agent"],
        exitCode: 0,
        passed: true,
        stdout: "",
        stderr: "",
        events: [],
        commandSurface: "testrun",
        executionId: "exec-partial",
        failures: [],
    };

    const packet = buildRepairPacket(exec, "Coverage: 2 / 3 criteria proven (67% proven)", {
        totalCriteria: 3,
        coveredCriteria: 3,
        provenCriteria: 2,
    });
    assert.strictEqual(packet.status, "PASSED_BUT_UNPROVEN");
    assert.strictEqual(packet.locked, false);
    assert.strictEqual(
        packet.summary,
        "Ratchet verification gate unproven: Execution passed but Kane CLI reports 2 of 3 criteria proven."
    );
});

test("buildRepairPacket distinguishes confirmed product bug from test execution failure", () => {
    // 1. Confirmed product bug from Kane verdict
    const productBugExec: KaneExecResult = {
        command: "kane-cli testmd run checkout_test.md --agent",
        args: ["testmd", "run", "checkout_test.md", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testmd",
        failures: [{ message: "Step 2 failed" }],
        events: [
            {
                type: "run_end",
                verdict: {
                    confirmed: true,
                    status: "failed",
                    family: "application_issue",
                    category: "validation_defect",
                    root_cause: "Promo code SAVE20 rejected as invalid",
                    bug_title: "SAVE20 rejected",
                    signals: [{ kind: "error_ui_text", excerpt: "Invalid code" }],
                    culprit_step: "2",
                },
            },
            {
                type: "test_md_bug_verdict",
                confirmed: true,
                bug_title: "SAVE20 rejected",
                family: "application_issue",
                one_liner: "Promo code SAVE20 rejected as invalid",
            },
        ],
    };

    const bugPacket = buildRepairPacket(productBugExec);
    assert.strictEqual(bugPacket.status, "BLOCKED");
    assert.strictEqual(bugPacket.locked, false);
    assert.strictEqual(bugPacket.failureAnalysis?.defectType, "product_defect");
    assert.strictEqual(bugPacket.failureAnalysis?.isConfirmedProductBug, true);
    assert.match(bugPacket.summary, /Confirmed Product Defect/);

    // 2. Browser action failure without confirmed product bug
    const actionFailExec: KaneExecResult = {
        command: "kane-cli testmd run checkout_test.md --agent",
        args: ["testmd", "run", "checkout_test.md", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testmd",
        failures: [{ message: "Timeout waiting for network idle" }],
        events: [],
    };

    const failPacket = buildRepairPacket(actionFailExec);
    assert.strictEqual(failPacket.status, "BLOCKED");
    assert.strictEqual(failPacket.locked, false);
    assert.strictEqual(failPacket.failureAnalysis?.defectType, "test_execution_failure");
    assert.strictEqual(failPacket.failureAnalysis?.isConfirmedProductBug, false);
    assert.match(failPacket.summary, /Unconfirmed Verification Failure/);
});

test("buildRepairPacket classifies confirmed: true explicitly as confirmed product defect", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testmd run checkout_test.md --agent",
        args: ["testmd", "run", "checkout_test.md", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testmd",
        failures: [{ message: "Step 2 failed" }],
        events: [
            {
                type: "run_end",
                verdict: {
                    confirmed: true,
                    status: "failed",
                    family: "application_issue",
                    root_cause: "Promo code SAVE20 rejected as invalid",
                    bug_title: "SAVE20 rejected",
                },
            },
        ],
    };

    const packet = buildRepairPacket(exec);
    assert.strictEqual(packet.failureAnalysis?.isConfirmedProductBug, true);
    assert.strictEqual(packet.failureAnalysis?.defectType, "product_defect");
    assert.match(packet.summary, /Confirmed Product Defect/);
});

test("buildRepairPacket classifies confirmed: false with application_issue family as unconfirmed verification failure", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testmd run checkout_test.md --agent",
        args: ["testmd", "run", "checkout_test.md", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testmd",
        failures: [{ message: "Step failed" }],
        events: [
            {
                type: "run_end",
                verdict: {
                    confirmed: false,
                    family: "application_issue",
                    root_cause: "Suspected UI timing issue",
                    bug_title: "Suspected UI timing issue",
                },
            },
        ],
    };

    const packet = buildRepairPacket(exec);
    assert.strictEqual(packet.failureAnalysis?.isConfirmedProductBug, false);
    assert.strictEqual(packet.failureAnalysis?.defectType, "test_execution_failure");
    assert.match(packet.summary, /Unconfirmed Verification Failure/);
    assert.doesNotMatch(packet.summary, /Confirmed Product Defect/);
});

test("buildRepairPacket classifies 740 result code without explicit confirmation as unconfirmed verification failure", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testmd run checkout_test.md --agent",
        args: ["testmd", "run", "checkout_test.md", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testmd",
        failures: [{ message: "Step failed" }],
        events: [
            {
                type: "run_end",
                result_code: 740,
                reason_code: "assertion_error.confirmed_product_bug",
                verdict: {
                    status: "failed",
                    result_code: 740,
                    family: "application_issue",
                    root_cause: "Assertion check failed",
                },
            },
        ],
    };

    const packet = buildRepairPacket(exec);
    assert.strictEqual(packet.failureAnalysis?.isConfirmedProductBug, false);
    assert.strictEqual(packet.failureAnalysis?.defectType, "test_execution_failure");
    assert.match(packet.summary, /Unconfirmed Verification Failure/);
    assert.doesNotMatch(packet.summary, /Confirmed Product Defect/);
});

test("buildRepairPacket builds diagnostics only from Kane's actual failure fields without inventing values", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testrun run --agent",
        args: ["testrun", "run", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testrun",
        failures: [
            {
                type: "member_failure",
                member_id: "mem-checkout",
                status: "failed",
                failure: {
                    message: "Assertion failed: expected value mismatch",
                    step_index: 2,
                },
                action_params: {
                    assertion_tree: {
                        passed: false,
                        description: "Check user profile role",
                        sub_results: [
                            {
                                description: "Profile role is admin",
                                expected: "admin",
                                extracted_value: "viewer",
                                passed: false,
                            },
                        ],
                    },
                },
            },
        ],
        events: [],
    };

    const packet = buildRepairPacket(exec, "Coverage: 1 / 2 criteria mapped");
    assert.strictEqual(packet.status, "BLOCKED");
    assert.strictEqual(packet.locked, false);
    assert.strictEqual(packet.failureAnalysis?.rootCause, "Assertion failed: expected value mismatch");
    assert.strictEqual(packet.failureAnalysis?.failedStep, 2);
    assert.strictEqual(packet.failureAnalysis?.failedMember, "mem-checkout");

    // Must extract actual diff without fabricating checkout or promo values
    assert.strictEqual(packet.failureAnalysis?.memoryDiffs.length, 1);
    const diff = packet.failureAnalysis?.memoryDiffs[0];
    assert.strictEqual(diff?.check, "Profile role is admin");
    assert.strictEqual(diff?.expected, "admin");
    assert.strictEqual(diff?.actual, "viewer");

    // Evidence unavailable when not provided
    assert.strictEqual(packet.evidence.executionId, "unavailable");
    assert.strictEqual(packet.evidence.evidencePack, "unavailable");
    assert.strictEqual(packet.evidence.replayCommand, "unavailable");
});

test("buildRepairPacket handles missing failure details by reporting unavailable instead of guessing", () => {
    const exec: KaneExecResult = {
        command: "kane-cli testrun run --agent",
        args: ["testrun", "run", "--agent"],
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "",
        commandSurface: "testrun",
        missingCompletion: true,
        failures: [],
        events: [],
    };

    const packet = buildRepairPacket(exec);
    assert.strictEqual(packet.status, "BLOCKED");
    assert.strictEqual(packet.locked, false);
    assert.strictEqual(packet.failureAnalysis?.rootCause, "Missing completion event from Kane CLI");
    assert.strictEqual(packet.failureAnalysis?.memoryDiffs.length, 0);
    assert.strictEqual(packet.evidence.executionId, "unavailable");
    assert.strictEqual(packet.evidence.replayCommand, "unavailable");
});
