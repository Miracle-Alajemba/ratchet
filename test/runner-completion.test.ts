import test from "node:test";
import assert from "node:assert";
import { evaluateRunResult } from "../src/engine/runner.js";

test("evaluateRunResult passes when testrun completes with passed status and exit 0", () => {
    const events = [
        { type: "testrun_start", v: 1 },
        { type: "testrun_member_start", member_id: "mem-1" },
        { type: "testrun_member_end", member_id: "mem-1", status: "passed" },
        { type: "testrun_summary", totals: { total: 1, passed: 1, failed: 0, broken: 0 } },
        { type: "testrun_done", overall_status: "passed", execution_id: "exec-101", pack: "pack-101.evidence" },
    ];

    const result = evaluateRunResult("testrun", events, 0);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.missingCompletion, false);
    assert.strictEqual(result.failures.length, 0);
    assert.strictEqual(result.executionId, "exec-101");
    assert.strictEqual(result.evidencePack, "pack-101.evidence");
});

test("evaluateRunResult fails when testrun_done overall_status is failed", () => {
    const events = [
        { type: "testrun_start", v: 1 },
        { type: "testrun_done", overall_status: "failed", execution_id: "exec-102" },
    ];

    const result = evaluateRunResult("testrun", events, 0);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.missingCompletion, false);
    assert.strictEqual(result.failures.length, 1);
    assert.match(result.failures[0].message, /testrun completed with overall status: failed/);
});

test("evaluateRunResult fails when completion event is missing (fail-closed)", () => {
    const events = [
        { type: "testrun_start", v: 1 },
        { type: "testrun_member_start", member_id: "mem-1" },
        // Process died before testrun_done
    ];

    const result = evaluateRunResult("testrun", events, 0);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.missingCompletion, true);
    assert.match(result.failures[0].message, /Missing completion event/);
});

test("evaluateRunResult fails when process exits with non-zero code even if events claim passed", () => {
    const events = [
        { type: "testrun_start", v: 1 },
        { type: "testrun_done", overall_status: "passed" },
    ];

    const result = evaluateRunResult("testrun", events, 1);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.failures.length, 1);
    assert.match(result.failures[0].message, /non-zero code: 1/);
});

test("evaluateRunResult fails when a member ends with failed, broken, interrupted, or cancelled status", () => {
    const statuses = ["failed", "broken", "interrupted", "cancelled"];

    for (const status of statuses) {
        const events = [
            { type: "testrun_start", v: 1 },
            {
                type: "testrun_member_end",
                member_id: "mem-bad",
                status,
                failure: { message: `Step assertion failed: status ${status}`, step_index: 2 },
            },
            { type: "testrun_done", overall_status: "passed" }, // Mismatched completion must still fail
        ];

        const result = evaluateRunResult("testrun", events, 0);
        assert.strictEqual(result.passed, false, `Expected fail-closed for member status ${status}`);
        assert.ok(result.failures.some((f) => f.member_id === "mem-bad"));
    }
});

test("evaluateRunResult handles spawn error fail-closed", () => {
    const result = evaluateRunResult("testrun", [], null, "ENOENT: binary not found");
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.missingCompletion, true);
    assert.match(result.failures[0].message, /Process spawn error: ENOENT/);
});

test("evaluateRunResult handles testmd surface with official test_md_done completion event", () => {
    const passedEvents = [
        { type: "stream_start", surface: "testmd" },
        { type: "test_md_step_end", step_index: 1, status: "passed" },
        { type: "test_md_done", overall_status: "passed", session_id: "sess-99" },
    ];
    const passResult = evaluateRunResult("testmd", passedEvents, 0);
    assert.strictEqual(passResult.passed, true);
    assert.strictEqual(passResult.executionId, "sess-99");

    const failedEvents = [
        { type: "stream_start", surface: "testmd" },
        { type: "test_md_step_end", step_index: 2, status: "failed" },
        { type: "test_md_done", overall_status: "failed", session_id: "sess-99" },
    ];
    const failResult = evaluateRunResult("testmd", failedEvents, 1);
    assert.strictEqual(failResult.passed, false);
});

test("evaluateRunResult handles run surface with official run_end completion event", () => {
    const passedEvents = [
        { type: "run_start", objective: "test" },
        { type: "run_end", status: "passed" },
    ];
    const passResult = evaluateRunResult("run", passedEvents, 0);
    assert.strictEqual(passResult.passed, true);

    const failedEvents = [
        { type: "run_start", objective: "test" },
        { type: "run_end", status: "failed", reason: "assertion failed" },
    ];
    const failResult = evaluateRunResult("run", failedEvents, 1);
    assert.strictEqual(failResult.passed, false);
});
