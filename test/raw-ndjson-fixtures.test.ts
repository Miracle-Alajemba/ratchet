import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNdjsonParser, evaluateRunResult, KaneExecResult } from "../src/engine/runner.js";
import { buildRepairPacket } from "../src/engine/packet.js";
import { SpecCoverageReport } from "../src/engine/spec.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseFixture(filename: string): any[] {
    const filePath = path.join(__dirname, "fixtures", filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const parser = createNdjsonParser();
    const events = parser.feed(content);
    events.push(...parser.flush());
    return events;
}

test("raw fixture broken testmd run: parses exact Kane events, detects bug verdict, step failure, and overall_status failed", () => {
    const events = parseFixture("kane-testmd-broken.ndjson");
    assert.ok(events.length > 0, "Expected non-empty events from raw broken fixture");

    // Verify top-level test_md_step_end events
    const stepEnds = events.filter((e) => e.type === "test_md_step_end");
    assert.strictEqual(stepEnds.length, 2);
    assert.strictEqual(stepEnds[0].step_index, 1);
    assert.strictEqual(stepEnds[0].status, "passed");
    assert.strictEqual(stepEnds[1].step_index, 2);
    assert.strictEqual(stepEnds[1].status, "failed");

    // Verify top-level test_md_done completion event
    const doneEvent = events.find((e) => e.type === "test_md_done");
    assert.ok(doneEvent, "Expected test_md_done event");
    assert.strictEqual(doneEvent.overall_status, "failed");

    // Evaluate result with exit code 1
    const evalResult = evaluateRunResult("testmd", events, 1);
    assert.strictEqual(evalResult.passed, false);
    assert.strictEqual(evalResult.missingCompletion, false);
    assert.strictEqual(evalResult.completionEvent.overall_status, "failed");
    assert.strictEqual(evalResult.executionId, "f61ce14d-fbda-4290-80c0-1d38c458a13b");
    assert.ok(evalResult.evidencePack?.includes("a131c194-9345-49f9-8b82-a6a90fb5193b.evidence"));

    // Check that runner parsed step failure, bug verdict, and done failure
    assert.ok(evalResult.failures.some((f) => f.type === "testmd_step_failure" && f.step_index === 2));
    assert.ok(evalResult.failures.some((f) => f.type === "testmd_bug_verdict" && f.confirmed === true));
    assert.ok(evalResult.failures.some((f) => f.type === "testmd_done_failure" && f.overall_status === "failed"));

    // Build RepairPacket
    const execResult: KaneExecResult = {
        command: "kane-cli testmd run complete-the-discounted-pro-plan-purchase_test.md --agent",
        args: ["testmd", "run", "complete-the-discounted-pro-plan-purchase_test.md", "--agent"],
        exitCode: 1,
        passed: evalResult.passed,
        stdout: "",
        stderr: "",
        events,
        commandSurface: "testmd",
        executionId: evalResult.executionId,
        evidencePack: evalResult.evidencePack,
        failures: evalResult.failures,
        completionEvent: evalResult.completionEvent,
        missingCompletion: evalResult.missingCompletion,
    };

    const brokenCoverage: SpecCoverageReport = {
        output: "Coverage: 1 / 4 acceptance criteria proven by Kane CLI (25% proven, 4 designed).",
        totalCriteria: 4,
        coveredCriteria: 4,
        provenCriteria: 1,
        gapsCount: 0,
        gaps: [],
    };

    const packet = buildRepairPacket(execResult, brokenCoverage);
    assert.strictEqual(packet.status, "BLOCKED");
    assert.strictEqual(packet.locked, false);
    assert.strictEqual(packet.failureAnalysis?.defectType, "product_defect");
    assert.strictEqual(packet.failureAnalysis?.isConfirmedProductBug, true);
    assert.ok(packet.failureAnalysis?.failedStep === 2 || packet.failureAnalysis?.failedStep === "1-4");
    assert.match(packet.failureAnalysis?.rootCause || "", /SAVE20/);
    assert.strictEqual(packet.coverage?.provenCriteria, 1);
});

test("raw fixture fixed testmd run: parses exact Kane events, validates 4/4 proven criteria and PROVEN lock", () => {
    const events = parseFixture("kane-testmd-fixed.ndjson");
    assert.ok(events.length > 0, "Expected non-empty events from raw fixed fixture");

    // Verify top-level test_md_step_end events for all 3 steps
    const stepEnds = events.filter((e) => e.type === "test_md_step_end");
    assert.strictEqual(stepEnds.length, 3);
    assert.strictEqual(stepEnds[0].step_index, 1);
    assert.strictEqual(stepEnds[0].status, "passed");
    assert.strictEqual(stepEnds[1].step_index, 2);
    assert.strictEqual(stepEnds[1].status, "passed");
    assert.strictEqual(stepEnds[2].step_index, 3);
    assert.strictEqual(stepEnds[2].status, "passed");

    // Verify top-level test_md_done completion event
    const doneEvent = events.find((e) => e.type === "test_md_done");
    assert.ok(doneEvent, "Expected test_md_done event");
    assert.strictEqual(doneEvent.overall_status, "passed");

    // Evaluate result with exit code 0
    const evalResult = evaluateRunResult("testmd", events, 0);
    assert.strictEqual(evalResult.passed, true);
    assert.strictEqual(evalResult.missingCompletion, false);
    assert.strictEqual(evalResult.failures.length, 0);
    assert.strictEqual(evalResult.executionId, "eb8d2e66-367e-46ae-b2d8-39f67b6e66e2");
    assert.ok(evalResult.evidencePack?.includes("711d9320-6597-4d12-8e4f-ee11f3d922e8.evidence"));

    // Build RepairPacket with 4/4 proven
    const execResult: KaneExecResult = {
        command: "kane-cli testmd run complete-the-discounted-pro-plan-purchase_test.md --agent",
        args: ["testmd", "run", "complete-the-discounted-pro-plan-purchase_test.md", "--agent"],
        exitCode: 0,
        passed: evalResult.passed,
        stdout: "",
        stderr: "",
        events,
        commandSurface: "testmd",
        executionId: evalResult.executionId,
        evidencePack: evalResult.evidencePack,
        failures: evalResult.failures,
        completionEvent: evalResult.completionEvent,
        missingCompletion: evalResult.missingCompletion,
    };

    const fixedCoverage: SpecCoverageReport = {
        output: "Coverage: 4 / 4 acceptance criteria proven by Kane CLI (100% proven, 4 designed).",
        totalCriteria: 4,
        coveredCriteria: 4,
        provenCriteria: 4,
        gapsCount: 0,
        gaps: [],
    };

    const packet = buildRepairPacket(execResult, fixedCoverage);
    assert.strictEqual(packet.status, "PROVEN");
    assert.strictEqual(packet.locked, true);
    assert.strictEqual(packet.coverage?.totalCriteria, 4);
    assert.strictEqual(packet.coverage?.provenCriteria, 4);
});

test("raw fixture missing completion: fails closed when test_md_done is missing", () => {
    const events = parseFixture("kane-testmd-missing-completion.ndjson");
    assert.ok(events.length > 0);
    assert.strictEqual(events.some((e) => e.type === "test_md_done"), false);

    const evalResult = evaluateRunResult("testmd", events, 0);
    assert.strictEqual(evalResult.passed, false, "Must fail closed if completion event is missing");
    assert.strictEqual(evalResult.missingCompletion, true);
    assert.ok(evalResult.failures.some((f) => f.message.includes("Missing completion event")));

    const execResult: KaneExecResult = {
        command: "kane-cli testmd run complete-the-discounted-pro-plan-purchase_test.md --agent",
        args: ["testmd", "run", "complete-the-discounted-pro-plan-purchase_test.md", "--agent"],
        exitCode: 0,
        passed: evalResult.passed,
        stdout: "",
        stderr: "",
        events,
        commandSurface: "testmd",
        failures: evalResult.failures,
        missingCompletion: evalResult.missingCompletion,
    };

    const packet = buildRepairPacket(execResult);
    assert.strictEqual(packet.status, "BLOCKED");
    assert.strictEqual(packet.locked, false);
});
