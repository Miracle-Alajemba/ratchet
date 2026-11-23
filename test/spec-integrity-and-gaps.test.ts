import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    computeFileSha256,
    detectStaleOrAltered,
    RatchetManifest,
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
