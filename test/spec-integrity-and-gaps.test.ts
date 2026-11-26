import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    computeFileSha256,
    detectStaleOrAltered,
    isDesignSuccessful,
    RatchetManifest,
    getCoverageStatus,
    markManifestCriteriaProven,
} from "../src/engine/spec.js";

test("detectStaleOrAltered passes when PRD and generated tests are unmodified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-int-"));
    const prdPath = path.join(tmpDir, "PRD.md");
    fs.writeFileSync(prdPath, "# Story\n- Criterion 1\n", "utf8");

    const testsDir = path.join(tmpDir, ".testmuai", "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    const testFile = path.join(testsDir, "story_test.md");
    fs.writeFileSync(testFile, "## Step 1 @verifies ac-1\nAssert something\n", "utf8");

    const manifest: RatchetManifest = {
        manifestVersion: 1,
        syncedAt: new Date().toISOString(),
        prdPath: "PRD.md",
        prdHash: computeFileSha256(prdPath),
        testFiles: {
            [path.relative(tmpDir, testFile)]: computeFileSha256(testFile),
        },
        criteria: [
            { id: "ac-1", text: "Criterion 1", status: "MAPPED", testFile: path.relative(tmpDir, testFile) },
        ],
    };

    fs.writeFileSync(
        path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
    );

    const check = detectStaleOrAltered(tmpDir, "PRD.md");
    assert.strictEqual(check.ok, true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("detectStaleOrAltered detects stale tests when PRD has been modified after sync", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-stale-"));
    const prdPath = path.join(tmpDir, "PRD.md");
    fs.writeFileSync(prdPath, "# Story\n- Criterion 1\n", "utf8");

    const testsDir = path.join(tmpDir, ".testmuai", "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    const testFile = path.join(testsDir, "story_test.md");
    fs.writeFileSync(testFile, "## Step 1 @verifies ac-1\nAssert something\n", "utf8");

    const manifest: RatchetManifest = {
        manifestVersion: 1,
        syncedAt: new Date().toISOString(),
        prdPath: "PRD.md",
        prdHash: computeFileSha256(prdPath),
        testFiles: {
            [path.relative(tmpDir, testFile)]: computeFileSha256(testFile),
        },
        criteria: [
            { id: "ac-1", text: "Criterion 1", status: "MAPPED", testFile: path.relative(tmpDir, testFile) },
        ],
    };

    fs.writeFileSync(
        path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
    );

    // Modify PRD after sync
    fs.appendFileSync(prdPath, "- Criterion 2 added\n", "utf8");

    const check = detectStaleOrAltered(tmpDir, "PRD.md");
    assert.strictEqual(check.ok, false);
    assert.match(check.reason || "", /Stale generated tests detected/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("detectStaleOrAltered detects altered generated tests when test file was modified", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-altered-"));
    const prdPath = path.join(tmpDir, "PRD.md");
    fs.writeFileSync(prdPath, "# Story\n- Criterion 1\n", "utf8");

    const testsDir = path.join(tmpDir, ".testmuai", "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    const testFile = path.join(testsDir, "story_test.md");
    fs.writeFileSync(testFile, "## Step 1 @verifies ac-1\nAssert strict equality\n", "utf8");

    const manifest: RatchetManifest = {
        manifestVersion: 1,
        syncedAt: new Date().toISOString(),
        prdPath: "PRD.md",
        prdHash: computeFileSha256(prdPath),
        testFiles: {
            [path.relative(tmpDir, testFile)]: computeFileSha256(testFile),
        },
        criteria: [
            { id: "ac-1", text: "Criterion 1", status: "MAPPED", testFile: path.relative(tmpDir, testFile) },
        ],
    };

    fs.writeFileSync(
        path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
    );

    // Silently weaken or alter the test file
    fs.writeFileSync(testFile, "## Step 1 @verifies ac-1\nAssert true\n", "utf8");

    const check = detectStaleOrAltered(tmpDir, "PRD.md");
    assert.strictEqual(check.ok, false);
    assert.match(check.reason || "", /Altered generated tests detected/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("isDesignSuccessful treats Kane EMPTY_DESIGN as success when receipt_sent has no parity but cover gaps confirms complete design", () => {
    // Real event shape from Kane CLI design run: receipt_sent telemetry without inline parity,
    // terminating on EMPTY_DESIGN error wrapped by AGENT_FAILED
    const rawNoopStdout = [
        JSON.stringify({
            ts: "2026-11-24T14:07:37.784Z",
            level: "info",
            kind: "receipt_sent",
            data: { commit_n: 1, chars: 300 },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:07:37.787Z",
            level: "info",
            kind: "design_commit_failed",
            data: {
                phase: "wiring",
                codes: ["EMPTY_DESIGN"],
                detail: "EMPTY_DESIGN: finalize_design produced nothing to commit",
            },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:07:37.788Z",
            level: "info",
            kind: "headless_commit_error_terminal",
            data: {
                error: "design commit failed: EMPTY_DESIGN: finalize_design produced nothing to commit",
            },
        }),
        JSON.stringify({
            type: "error",
            code: "AGENT_FAILED",
            message: "error: design agent failed: design commit failed: EMPTY_DESIGN: finalize_design produced nothing to commit",
        }),
    ].join("\n");

    // Complete design with historical execution-failed pending items, happy-only recommendation,
    // and an unspecified invalid-promo gap in other
    const stubbedGapsCompleteWithExecutionAndUnspecified = {
        usecases: [
            {
                id: "uc-1",
                name: "Pro Plan Checkout",
                designed: { criteria: 8, of: 8 },
                coverage: { criteria: 8 },
                pending: [
                    {
                        ref: "ac-2",
                        kind: "execution-failed",
                        stage: "cover",
                        tag: "evolve",
                        why: "covering test failed against this AC",
                    },
                    {
                        ref: "uc-1",
                        kind: "happy-only",
                        stage: "design",
                        tag: "create",
                        why: "use-case is exercised by happy-path scenarios only",
                    },
                ],
                stale_acs: 0,
                design_completeness: {
                    status: "complete",
                    missing_criteria: 0,
                    missing_scenarios: 0,
                    unwired_scenarios: 0,
                },
            },
        ],
        other: [
            {
                ref: "uc-1",
                kind: "incomplete",
                stage: "design",
                why: "behavior on invalid promo-code is unspecified",
            },
        ],
    };

    const result = isDesignSuccessful(
        {
            code: 1,
            stdout: rawNoopStdout,
            stderr: "",
        },
        stubbedGapsCompleteWithExecutionAndUnspecified,
        "uc-1"
    );

    assert.strictEqual(result, true);
});

test("isDesignSuccessful rejects EMPTY_DESIGN with receipt_sent when cover gaps confirms incomplete design", () => {
    const rawNoopStdout = [
        JSON.stringify({
            ts: "2026-11-24T14:07:37.784Z",
            level: "info",
            kind: "receipt_sent",
            data: { commit_n: 1, chars: 300 },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:07:37.787Z",
            level: "info",
            kind: "design_commit_failed",
            data: {
                phase: "wiring",
                codes: ["EMPTY_DESIGN"],
                detail: "EMPTY_DESIGN: finalize_design produced nothing to commit",
            },
        }),
        JSON.stringify({
            type: "error",
            code: "AGENT_FAILED",
            message: "error: design agent failed: design commit failed: EMPTY_DESIGN: finalize_design produced nothing to commit",
        }),
    ].join("\n");

    // 1. Incomplete design status
    const stubbedGapsIncompleteStatus = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 5, of: 8 },
                pending: [],
                stale_acs: 0,
                design_completeness: { status: "needs-tests" },
            },
        ],
        other: [],
    };

    assert.strictEqual(
        isDesignSuccessful(
            { code: 1, stdout: rawNoopStdout, stderr: "" },
            stubbedGapsIncompleteStatus,
            "uc-1"
        ),
        false
    );

    // 2. Real missing/unwired design items in pending (e.g. stage: "design", kind: "no-verifies")
    const stubbedGapsRealMissing = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                pending: [
                    {
                        ref: "ac-3",
                        kind: "no-verifies",
                        stage: "design",
                        why: "no live test verifies this acceptance criterion",
                    },
                ],
                stale_acs: 0,
                design_completeness: { status: "complete" },
            },
        ],
        other: [],
    };

    assert.strictEqual(
        isDesignSuccessful(
            { code: 1, stdout: rawNoopStdout, stderr: "" },
            stubbedGapsRealMissing,
            "uc-1"
        ),
        false
    );

    // 3. Real blocked design items in pending (e.g. stage: "design", kind: "blocked-design")
    const stubbedGapsRealBlockedPending = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                pending: [
                    {
                        ref: "sc-1",
                        kind: "zero-scenario",
                        stage: "design",
                        why: "use-case has no scenarios",
                    },
                ],
                stale_acs: 0,
                design_completeness: { status: "complete" },
            },
        ],
        other: [],
    };

    assert.strictEqual(
        isDesignSuccessful(
            { code: 1, stdout: rawNoopStdout, stderr: "" },
            stubbedGapsRealBlockedPending,
            "uc-1"
        ),
        false
    );

    // 4. Stale ACs in usecase
    const stubbedGapsStaleAcs = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                pending: [],
                stale_acs: 1,
                design_completeness: { status: "complete" },
            },
        ],
        other: [],
    };

    assert.strictEqual(
        isDesignSuccessful(
            { code: 1, stdout: rawNoopStdout, stderr: "" },
            stubbedGapsStaleAcs,
            "uc-1"
        ),
        false
    );

    // 5. Genuine blocked/unresolved gap in other referring to uc-1
    const stubbedGapsBlockedOther = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                pending: [],
                stale_acs: 0,
                design_completeness: { status: "complete" },
            },
        ],
        other: [
            {
                uc: "uc-1",
                type: "blocked_design",
                why: "Missing product login credentials for test generation",
            },
        ],
    };

    assert.strictEqual(
        isDesignSuccessful(
            { code: 1, stdout: rawNoopStdout, stderr: "" },
            stubbedGapsBlockedOther,
            "uc-1"
        ),
        false
    );
});

test("isDesignSuccessful fails closed when nonzero exit is a genuine design failure", () => {
    const stubbedGapsComplete = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                pending: [],
                stale_acs: 0,
                design_completeness: { status: "complete" },
            },
        ],
        other: [],
    };

    // 1. Nonzero exit with a different failure code (e.g. UNSETTLED)
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: JSON.stringify({
                    kind: "design_commit_failed",
                    data: { phase: "wiring", codes: ["UNSETTLED"], detail: "concurrent activity moving store" },
                }),
                stderr: "error: design commit failed",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 2. Nonzero exit without cover gaps confirmation (null or missing)
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        kind: "receipt_sent",
                        data: { commit_n: 1 },
                    }),
                    JSON.stringify({
                        kind: "design_commit_failed",
                        data: { codes: ["EMPTY_DESIGN"], detail: "EMPTY_DESIGN: finalize_design produced nothing to commit" },
                    }),
                ].join("\n"),
                stderr: "",
            },
            null,
            "uc-1"
        ),
        false
    );

    // 3. Nonzero exit where prose mentions "complete" or "already designed" without valid no-op
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: "error: design was not complete and could not be already designed",
                stderr: "fatal error: process crashed",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 4. Nonzero exit with EMPTY_DESIGN alongside another error code
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        kind: "receipt_sent",
                        data: { commit_n: 1 },
                    }),
                    JSON.stringify({
                        kind: "design_commit_failed",
                        data: { codes: ["EMPTY_DESIGN", "SYNTAX_ERROR"], detail: "EMPTY_DESIGN: finalize_design produced nothing to commit" },
                    }),
                ].join("\n"),
                stderr: "",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 5. Nonzero exit with EMPTY_DESIGN but an arbitrary unrelated AGENT_FAILED error event
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        kind: "receipt_sent",
                        data: { commit_n: 1 },
                    }),
                    JSON.stringify({
                        kind: "design_commit_failed",
                        data: { codes: ["EMPTY_DESIGN"], detail: "EMPTY_DESIGN: finalize_design produced nothing to commit" },
                    }),
                    JSON.stringify({
                        type: "error",
                        code: "AGENT_FAILED",
                        message: "The design agent crashed or failed unexpectedly",
                    }),
                ].join("\n"),
                stderr: "",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 6. Nonzero exit with EMPTY_DESIGN but structured data.code is SYNTAX_ERROR
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        kind: "receipt_sent",
                        data: { commit_n: 1 },
                    }),
                    JSON.stringify({
                        kind: "design_commit_failed",
                        data: { codes: ["EMPTY_DESIGN"], detail: "EMPTY_DESIGN: finalize_design produced nothing to commit" },
                    }),
                    JSON.stringify({
                        kind: "error",
                        data: {
                            code: "SYNTAX_ERROR",
                            message: "Syntax error in generated test template",
                        },
                    }),
                ].join("\n"),
                stderr: "",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 7. Arbitrary NOTHING_SAVED without note or with unrelated wording
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        type: "error",
                        code: "NOTHING_SAVED",
                        message: "error: the design session stopped before saving anything — nothing committed",
                    }),
                ].join("\n"),
                stderr: "",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );

    // 8. NOTHING_SAVED with unrelated error code (e.g. TIMEOUT)
    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: [
                    JSON.stringify({
                        type: "error",
                        code: "NOTHING_SAVED",
                        codes: ["NOTHING_SAVED", "TIMEOUT"],
                        message: "error: the design session stopped before saving anything — nothing committed",
                        note: "The old and new wording at line 8 is identical, so I left the existing base-price scenario unchanged",
                    }),
                ].join("\n"),
                stderr: "",
            },
            stubbedGapsComplete,
            "uc-1"
        ),
        false
    );
});

test("isDesignSuccessful treats Kane NOTHING_SAVED as success when design is unchanged and cover gaps confirms complete design", () => {
    // Actual event shape from design-as-20261124T1437-5t9m788o.log:
    // Zero-op completion, followed by NOTHING_SAVED error event and note explaining unchanged wording
    const noteText =
        "The old and new wording at line 8 is identical, so I left the existing base-price scenario sc-10 and test t-10 unchanged rather than superseding them.";

    const rawNothingSavedStdout = [
        JSON.stringify({
            ts: "2026-11-24T14:37:25.889Z",
            level: "info",
            kind: "chat_ops",
            session_id: "design-20261124T143704-13868b7e",
            data: {
                type: "chat_ops",
                chat_ops: {
                    ops: [],
                    text: `I rechecked the current PRD against the recorded change for **uc-1**. ${noteText}`,
                },
            },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:37:25.889Z",
            level: "info",
            kind: "headless_zero_op_chat_turn_complete",
            session_id: "design-20261124T143704-13868b7e",
            data: { chars: 474 },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:37:25.912Z",
            level: "info",
            kind: "session_complete",
            session_id: "design-20261124T143704-13868b7e",
            data: { type: "session_complete", sid: "design-20261124T143704-13868b7e", status: "ok" },
        }),
        JSON.stringify({
            type: "error",
            code: "NOTHING_SAVED",
            message:
                "error: the design session stopped before saving anything — nothing committed (trace: /home/miracle-alajemba/.testmuai/kaneai/assurance/ctx-26e8016f662b/logs/design-as-20261124T1437-5t9m788o.log)",
            note: `the design agent kept the design, but what it was designed against moved since: ${noteText}`,
        }),
    ].join("\n");

    const stubbedGapsComplete = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 8, of: 8 },
                coverage: { criteria: 8 },
                pending: [],
                stale_acs: 0,
                design_completeness: {
                    status: "complete",
                    missing_criteria: 0,
                    missing_scenarios: 0,
                    unwired_scenarios: 0,
                },
            },
        ],
        other: [],
    };

    const result = isDesignSuccessful(
        {
            code: 1,
            stdout: rawNothingSavedStdout,
            stderr: "",
        },
        stubbedGapsComplete,
        "uc-1"
    );

    assert.strictEqual(result, true);

    // Fails closed if cover gaps confirms incomplete design
    const stubbedGapsIncomplete = {
        usecases: [
            {
                id: "uc-1",
                designed: { criteria: 4, of: 8 },
                pending: [],
                stale_acs: 0,
                design_completeness: { status: "needs-tests" },
            },
        ],
        other: [],
    };

    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: rawNothingSavedStdout,
                stderr: "",
            },
            stubbedGapsIncomplete,
            "uc-1"
        ),
        false
    );
});

test("isDesignSuccessful treats Kane EMPTY_DESIGN as success with exact cover gaps schema (happy-only, covered-not-run, and unlinked other gaps)", () => {
    // Exact event shape from failed uc-1 design session (EMPTY_DESIGN: finalize_design produced nothing to commit)
    const rawFailedSyncStdout = [
        JSON.stringify({
            ts: "2026-11-24T14:52:26.257Z",
            level: "info",
            kind: "receipt_sent",
            session_id: "design-20261124T145200-d1e8589d",
            data: { commit_n: 2, chars: 306 },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:52:31.529Z",
            level: "info",
            kind: "design_commit_failed",
            data: {
                phase: "wiring",
                codes: ["EMPTY_DESIGN"],
                detail: "EMPTY_DESIGN: finalize_design produced nothing to commit",
            },
        }),
        JSON.stringify({
            ts: "2026-11-24T14:52:31.530Z",
            level: "info",
            kind: "headless_commit_error_terminal",
            session_id: "design-20261124T145200-d1e8589d",
            data: { error: "design commit failed: EMPTY_DESIGN: finalize_design produced nothing to commit" },
        }),
        JSON.stringify({
            type: "error",
            code: "AGENT_FAILED",
            message: "error: design agent failed: design commit failed: EMPTY_DESIGN: finalize_design produced nothing to commit",
        }),
    ].join("\n");

    // Exact cover gaps --json shape from Kane:
    // uc-1: designed: {criteria: 1, of: 1}, design_completeness.status: "complete", stale_acs: 0,
    // pending items happy-only (stage design) and covered-not-run (stage cover).
    // other invalid-promo gaps are incomplete/ambiguous and not linked to uc-1.
    // ucs_needing_scenarios === 0 and designed.usecases === designed.of.
    const realCoverGapsFixture = {
        stage: "all",
        rollup_version: 2,
        designed: { usecases: 1, of: 1 },
        design_completeness: {
            acs_designed: "1/1",
            usecases_complete: "1/1",
            ucs_needing_scenarios: 0,
            config: {
                criterion: "live_verifies_edge",
                freshness: "not_discounted",
            },
        },
        usecases: [
            {
                id: "uc-1",
                title: "Purchase the Pro Plan with a promotional discount",
                risk: "high",
                coverage: { pct: 0, state: "not_run", criteria: 1, proven: 0 },
                designed: { criteria: 1, of: 1 },
                design_completeness: { status: "complete" },
                stale_acs: 0,
                pending: [
                    {
                        ref: "uc-1",
                        kind: "happy-only",
                        why: "use-case is exercised by happy-path scenarios only",
                        risk: "low",
                        stage: "design",
                        tag: "create",
                        ready_command: "kane-cli design tests --use-case uc-1",
                        id: "uc-1",
                        title: "Purchase the Pro Plan with a promotional discount",
                    },
                    {
                        ref: "ac-1",
                        kind: "covered-not-run",
                        stage: "cover",
                        tag: "create",
                        risk: "med",
                        why: "covering test exists and is reusable",
                        ready_command: "kane-cli testrun run",
                    },
                ],
            },
        ],
        other: [
            {
                ref: "gap-1",
                kind: "incomplete",
                stage: "design",
                why: "behavior for invalid promo codes is unspecified",
            },
            {
                ref: "gap-2",
                kind: "ambiguous",
                stage: "design",
                why: "how should invalid promo codes be handled",
            },
        ],
    };

    const result = isDesignSuccessful(
        {
            code: 1,
            stdout: rawFailedSyncStdout,
            stderr: "",
        },
        realCoverGapsFixture,
        "uc-1"
    );

    assert.strictEqual(result, true);

    // Fail closed if genuine design blocker exists (e.g. stage "design" with real missing scenario)
    const brokenDesignFixture = {
        ...realCoverGapsFixture,
        usecases: [
            {
                ...realCoverGapsFixture.usecases[0],
                pending: [
                    ...realCoverGapsFixture.usecases[0].pending,
                    {
                        ref: "uc-1",
                        kind: "zero-scenario",
                        stage: "design",
                        why: "use-case has no scenarios",
                    },
                ],
            },
        ],
    };

    assert.strictEqual(
        isDesignSuccessful(
            {
                code: 1,
                stdout: rawFailedSyncStdout,
                stderr: "",
            },
            brokenDesignFixture,
            "uc-1"
        ),
        false
    );
});

test("markManifestCriteriaProven updates manifest for passing test files and refreshes proven state", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-mark-"));
    const prdPath = path.join(tmpDir, "PRD.md");
    fs.writeFileSync(prdPath, "# Story\n- Criterion 1\n- Criterion 2\n", "utf8");

    const testsDir = path.join(tmpDir, ".testmuai", "tests");
    fs.mkdirSync(testsDir, { recursive: true });
    const testFile1 = path.join(testsDir, "flow1_test.md");
    const testFile2 = path.join(testsDir, "flow2_test.md");
    fs.writeFileSync(testFile1, "## Step 1 @verifies ac-1\n", "utf8");
    fs.writeFileSync(testFile2, "## Step 1 @verifies ac-2\n", "utf8");

    const manifest: RatchetManifest = {
        manifestVersion: 1,
        syncedAt: new Date().toISOString(),
        prdPath: "PRD.md",
        prdHash: computeFileSha256(prdPath),
        testFiles: {
            [path.relative(tmpDir, testFile1)]: computeFileSha256(testFile1),
            [path.relative(tmpDir, testFile2)]: computeFileSha256(testFile2),
        },
        criteria: [
            { id: "ac-1", text: "Criterion 1", status: "MAPPED", testFile: path.relative(tmpDir, testFile1), proven: false },
            { id: "ac-2", text: "Criterion 2", status: "MAPPED", testFile: path.relative(tmpDir, testFile2), proven: false },
        ],
    };

    fs.writeFileSync(
        path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8"
    );

    // 1. Mark only flow1_test.md as passed
    markManifestCriteriaProven(tmpDir, [path.relative(tmpDir, testFile1)]);
    const updated1: RatchetManifest = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"), "utf8")
    );
    assert.strictEqual(updated1.criteria.find((c) => c.id === "ac-1")?.proven, true);
    assert.strictEqual(updated1.criteria.find((c) => c.id === "ac-2")?.proven, false);

    // 2. Mark all as passed (no filter)
    markManifestCriteriaProven(tmpDir);
    const updated2: RatchetManifest = JSON.parse(
        fs.readFileSync(path.join(tmpDir, ".testmuai", ".ratchet_manifest.json"), "utf8")
    );
    assert.strictEqual(updated2.criteria.find((c) => c.id === "ac-1")?.proven, true);
    assert.strictEqual(updated2.criteria.find((c) => c.id === "ac-2")?.proven, true);

    // 3. getCoverageStatus evaluates scoped coverage from manifest
    const coverage = getCoverageStatus(tmpDir, "PRD.md");
    assert.strictEqual(coverage.totalCriteria, 2);
    assert.strictEqual(coverage.provenCriteria, 2);
    assert.strictEqual(coverage.gapsCount, 0);
    assert.match(coverage.output, /2 \/ 2 acceptance criteria proven/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});
