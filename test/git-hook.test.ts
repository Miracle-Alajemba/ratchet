import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { installPrePushHook } from "../src/engine/hook.js";

test("installPrePushHook installs hook in clean repo", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-hook-clean-"));
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const result = installPrePushHook(tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.chained, false);

    const content = fs.readFileSync(result.hookPath, "utf8");
    assert.ok(content.includes("npx ratchet verify"));
    assert.ok(content.includes("can be bypassed"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("installPrePushHook preserves and chains existing pre-push hook", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-hook-chain-"));
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const existingScript = "#!/bin/sh\necho 'running lint'\n";
    const hookPath = path.join(hooksDir, "pre-push");
    fs.writeFileSync(hookPath, existingScript, { mode: 0o755 });

    const result = installPrePushHook(tmpDir);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.chained, true);
    assert.ok(result.legacyPath);
    assert.strictEqual(fs.existsSync(result.legacyPath), true);

    const legacyContent = fs.readFileSync(result.legacyPath, "utf8");
    assert.strictEqual(legacyContent, existingScript);

    const newContent = fs.readFileSync(hookPath, "utf8");
    assert.ok(newContent.includes('"$0.legacy" "$@" || exit $?'));
    assert.ok(newContent.includes("npx ratchet verify"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
});
