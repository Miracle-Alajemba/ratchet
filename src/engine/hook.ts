import fs from "node:fs";
import path from "node:path";

export interface HookInstallResult {
    success: boolean;
    hookPath: string;
    chained: boolean;
    legacyPath?: string;
    message: string;
}

export function installPrePushHook(gitDir: string = process.cwd()): HookInstallResult {
    const hooksDir = path.join(gitDir, ".git", "hooks");
    if (!fs.existsSync(hooksDir)) {
        throw new Error("Not a git repository: .git/hooks directory not found.");
    }

    const hookPath = path.join(hooksDir, "pre-push");
    let chained = false;
    let legacyPath: string | undefined = undefined;

    if (fs.existsSync(hookPath)) {
        const existing = fs.readFileSync(hookPath, "utf8");
        if (existing.includes("ratchet verify")) {
            return {
                success: true,
                hookPath,
                chained: false,
                message: "Ratchet pre-push hook is already installed.",
            };
        }

        // Preserve existing hook by saving it as pre-push.legacy
        legacyPath = path.join(hooksDir, "pre-push.legacy");
        fs.writeFileSync(legacyPath, existing, { mode: 0o755 });
        chained = true;
    }

    const script = `#!/bin/sh
# Ratchet Pre-Push Gate
# NOTE: Local git hooks are client-side safeguards and can be bypassed (e.g. via git push --no-verify).
# For tamper-proof verification, enforce Ratchet in your CI/CD pipeline.

# Safely chain any existing pre-push hook
if [ -x "$0.legacy" ]; then
  "$0.legacy" "$@" || exit $?
fi

echo "🔒 Ratchet Pre-Push Gate: verifying acceptance criteria via Kane CLI..."
npx ratchet verify || {
  echo "✖ Ratchet verification failed. Push blocked."
  exit 1
}
`;

    fs.writeFileSync(hookPath, script, { mode: 0o755 });

    return {
        success: true,
        hookPath,
        chained,
        legacyPath,
        message: chained
            ? "Preserved existing pre-push hook as 'pre-push.legacy' and installed chained Ratchet gate."
            : "Installed Ratchet pre-push hook successfully.",
    };
}
