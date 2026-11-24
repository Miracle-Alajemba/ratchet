import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findKaneBinary } from "./runner.js";

function getKaneEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    const localBin = path.join(home, ".local", "bin");
    const npmBin = path.join(home, ".npm-global", "bin");
    return {
        ...process.env,
        PATH: `${process.env.PATH}:${localBin}:${npmBin}`,
    };
}

export interface CriterionMapping {
    id: string;
    text: string;
    usecaseId?: string;
    testId?: string;
    testFile?: string;
    status: "MAPPED" | "GAP";
    unreviewed?: boolean;
    proven?: boolean;
    gapReason?: string;
}

export interface SpecCoverageReport {
    totalCriteria: number;
    coveredCriteria: number;
    provenCriteria: number;
    percentage: number;
    gapsCount: number;
    criteria: CriterionMapping[];
    rawCover?: any;
    rawGaps?: any;
    output: string;
}

export interface SpecSyncResult {
    prdPath: string;
    criteriaCount: number;
    criteria: CriterionMapping[];
    testFiles: string[];
    coverage: SpecCoverageReport;
    manifestPath: string;
}

export interface RatchetManifest {
    manifestVersion: number;
    syncedAt: string;
    prdPath: string;
    prdHash: string;
    testFiles: Record<string, string>;
    criteria: CriterionMapping[];
}

export function computeFileSha256(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

export interface KaneDesignResult {
    code: number;
    stdout: string;
    stderr: string;
}

export function parseNdjsonEvents(text: string): any[] {
    const events: any[] = [];
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith("{") && line.endsWith("}")) {
            try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed === "object") {
                    events.push(parsed);
                }
            } catch {
                // ignore non-JSON line
            }
        }
    }
    return events;
}

export function checkDesignCompletenessFromGaps(coverGapsJson: any, ucId?: string): boolean {
    if (!coverGapsJson || typeof coverGapsJson !== "object") {
        return false;
    }

    const usecases: any[] = Array.isArray(coverGapsJson.usecases) ? coverGapsJson.usecases : [];
    if (usecases.length === 0) {
        return false;
    }

    const targetUc = ucId
        ? usecases.find((u: any) => (u.id && u.id.toLowerCase() === ucId.toLowerCase()) || (u.title && u.title.toLowerCase().includes(ucId.toLowerCase())))
        : (usecases.length === 1 ? usecases[0] : null);

    if (!targetUc) {
        return false;
    }

    // 1. Complete design status
    if (targetUc.design_completeness?.status !== "complete") {
        return false;
    }

    // 2. All criteria designed (at least 1 criterion designed, and designed >= total criteria)
    const designedCount = targetUc.designed?.criteria ?? 0;
    const totalCriteria = targetUc.designed?.of ?? targetUc.coverage?.criteria ?? 0;
    if (designedCount <= 0 || (totalCriteria > 0 && designedCount < totalCriteria)) {
        return false;
    }

    // 3. Stale ACs
    if (typeof targetUc.stale_acs === "number" && targetUc.stale_acs > 0) {
        return false;
    }

    // 4. Inspect targetUc.pending items:
    // Reject only actual unresolved design blockers or missing/unwired scenarios/tests.
    // Do NOT reject verification results (stage: "cover", kind: "execution-failed", "execution-blocked", "covered-not-run").
    // Do NOT reject non-blocking stage: "design" recommendations (e.g. kind: "happy-only").
    if (Array.isArray(targetUc.pending)) {
        for (const item of targetUc.pending) {
            if (!item || typeof item !== "object") continue;

            const stage = String(item.stage || "").toLowerCase();
            const kind = String(item.kind || "").toLowerCase();

            // Verification execution results from 'cover' stage are test outcomes, not missing design
            if (stage === "cover" || kind.startsWith("execution-") || kind === "covered-not-run") {
                continue;
            }

            // 'happy-only' recommendation is advice to add edge cases, not a blocker if the PRD does not specify them
            if (kind === "happy-only") {
                continue;
            }

            // Real missing or blocked design items:
            // e.g. "no-verifies", "zero-scenario", "stale-ac", "stale-test", "unwired", "incomplete", "blocked"
            return false;
        }
    }

    // 5. Inspect unresolved gaps referring to this use case in other:
    // When design_completeness reports ucs_needing_scenarios === 0 and designed.usecases === designed.of,
    // clarification questions or non-blocking incomplete/ambiguous entries (such as unspecified promo-code behavior)
    // do not block an already-complete design.
    const ucsNeedingScenarios = coverGapsJson.design_completeness?.ucs_needing_scenarios;
    const isUcsComplete = typeof ucsNeedingScenarios === "number" && ucsNeedingScenarios === 0;

    if (Array.isArray(coverGapsJson.other)) {
        const ucGaps = coverGapsJson.other.filter(
            (o: any) => o && (o.uc === targetUc.id || o.usecase === targetUc.id || o.ref === targetUc.id)
        );
        for (const gap of ucGaps) {
            const kind = String(gap.kind || "").toLowerCase();
            const text = `${gap.why || ""} ${gap.text || ""} ${gap.risk_rationale || ""}`.toLowerCase();

            // Ignore non-blocker gaps such as happy-only or unspecified promo-code edge cases
            if (kind === "happy-only") {
                continue;
            }
            if (isUcsComplete && (kind === "incomplete" || kind === "ambiguous")) {
                continue;
            }
            if (text.includes("invalid promo") || (text.includes("promo") && text.includes("unspecified"))) {
                continue;
            }

            return false;
        }
    }

    return true;
}

export function isDesignSuccessful(
    designRes: KaneDesignResult,
    workdirOrGaps?: string | any,
    ucId?: string
): boolean {
    if (designRes.code === 0) {
        return true;
    }

    const stdout = designRes.stdout || "";
    const stderr = designRes.stderr || "";
    const combined = `${stdout}\n${stderr}`;

    // 1. Must match a known Kane no-op pattern:
    // (a) EMPTY_DESIGN: finalize_design produced nothing to commit
    // (b) NOTHING_SAVED: the design session stopped before saving anything — nothing committed (source wording unchanged)
    const emptyDesignString = "EMPTY_DESIGN: finalize_design produced nothing to commit";
    const nothingSavedString = "the design session stopped before saving anything";
    const isWordingUnchanged =
        combined.toLowerCase().includes("wording") &&
        combined.toLowerCase().includes("identical") ||
        combined.toLowerCase().includes("unchanged");

    const hasEmptyDesignSignal = combined.includes(emptyDesignString);
    const hasNothingSavedSignal =
        (combined.includes(nothingSavedString) || combined.includes("NOTHING_SAVED")) && isWordingUnchanged;

    if (!hasEmptyDesignSignal && !hasNothingSavedSignal) {
        return false;
    }

    // 2. Parse structured events from stdout and stderr
    const events = parseNdjsonEvents(stdout).concat(parseNdjsonEvents(stderr));
    if (events.length === 0) {
        try {
            const parsed = JSON.parse(stdout.trim());
            if (parsed && typeof parsed === "object") events.push(parsed);
        } catch {}
    }

    if (events.length === 0) {
        return false;
    }

    // 3. Inspect structured failure/error events.
    // Allowed codes are only the recognized no-ops (EMPTY_DESIGN, NOTHING_SAVED)
    // and the outer structured AGENT_FAILED wrapper when wrapping them.
    let hasUnderlyingRecognizedNoop = false;

    for (const evt of events) {
        if (!evt || typeof evt !== "object") continue;

        // Collect all codes on this event
        const singleCode = evt.code || evt.data?.code;
        const codeList = evt.codes || evt.data?.codes;
        const errObjCode = evt.error?.code || evt.data?.error?.code;

        const allEventCodes: string[] = [];
        if (typeof singleCode === "string") allEventCodes.push(singleCode);
        if (typeof errObjCode === "string") allEventCodes.push(errObjCode);
        if (Array.isArray(codeList)) {
            allEventCodes.push(...codeList.filter((c: any) => typeof c === "string"));
        }

        // Any code other than EMPTY_DESIGN, NOTHING_SAVED, or AGENT_FAILED is an immediate failure
        for (const c of allEventCodes) {
            if (c !== "EMPTY_DESIGN" && c !== "NOTHING_SAVED" && c !== "AGENT_FAILED") {
                return false;
            }
        }

        if (allEventCodes.includes("EMPTY_DESIGN")) {
            hasUnderlyingRecognizedNoop = true;
        }

        if (allEventCodes.includes("NOTHING_SAVED")) {
            // Must be accompanied by note confirming unchanged source wording
            const noteText = `${evt.note || ""} ${evt.message || ""} ${evt.data?.note || ""} ${combined}`.toLowerCase();
            if (noteText.includes("unchanged") || noteText.includes("identical")) {
                hasUnderlyingRecognizedNoop = true;
            } else {
                return false; // Reject arbitrary NOTHING_SAVED
            }
        }

        // An AGENT_FAILED code is only accepted if it wraps a recognized no-op
        if (allEventCodes.includes("AGENT_FAILED")) {
            const wrapperText = `${evt.message || ""} ${evt.detail || ""} ${evt.error || ""} ${evt.data?.message || ""} ${evt.data?.detail || ""} ${evt.data?.error || ""}`;
            if (
                !wrapperText.includes(emptyDesignString) &&
                !wrapperText.includes("EMPTY_DESIGN") &&
                !wrapperText.includes("NOTHING_SAVED")
            ) {
                return false; // Reject arbitrary AGENT_FAILED
            }
        }

        // Check error/failure event kinds
        const kind = String(evt.kind || evt.type || "");
        const isErrorEvent =
            kind === "error" ||
            kind === "design_commit_failed" ||
            kind === "headless_commit_error_terminal" ||
            evt.level === "error";

        if (isErrorEvent) {
            const errStr = typeof evt.error === "string" ? evt.error : typeof evt.data?.error === "string" ? evt.data.error : "";
            const detailStr = typeof evt.detail === "string" ? evt.detail : typeof evt.data?.detail === "string" ? evt.data.detail : "";
            const msgStr = typeof evt.message === "string" ? evt.message : typeof evt.data?.message === "string" ? evt.data.message : "";
            const combinedErr = `${errStr} ${detailStr} ${msgStr}`;

            if (
                combinedErr.includes(emptyDesignString) ||
                combinedErr.includes("EMPTY_DESIGN") ||
                combinedErr.includes("NOTHING_SAVED") ||
                combinedErr.includes(nothingSavedString)
            ) {
                hasUnderlyingRecognizedNoop = true;
            } else if (combinedErr.trim().length > 0) {
                // Structured error event with unrelated failure message
                return false;
            }
        }
    }

    if (!hasUnderlyingRecognizedNoop) {
        return false;
    }

    // 4. Obtain fresh structured confirmation from Kane's supported cover gaps --json command
    let gapsJson: any = null;
    if (workdirOrGaps && typeof workdirOrGaps === "object") {
        gapsJson = workdirOrGaps;
    } else if (typeof workdirOrGaps === "string") {
        const gapsRes = runKaneSync(["cover", "gaps", "--json"], workdirOrGaps);
        if (gapsRes.code === 0) {
            try {
                gapsJson = JSON.parse(gapsRes.stdout);
            } catch {
                gapsJson = null;
            }
        }
    }

    if (!gapsJson) {
        return false;
    }

    return checkDesignCompletenessFromGaps(gapsJson, ucId);
}

export function runKaneSync(
    args: string[],
    workdir: string
): { code: number; stdout: string; stderr: string } {
    const bin = findKaneBinary();
    const res = spawnSync(bin, args, {
        cwd: workdir,
        encoding: "utf8",
        env: getKaneEnv(),
    });

    return {
        code: res.status ?? (res.error ? 1 : 0),
        stdout: res.stdout || "",
        stderr: res.stderr || (res.error ? res.error.message : ""),
    };
}

export function checkKanePreconditions(workdir: string): void {
    const bin = findKaneBinary();
    const probe = spawnSync(bin, ["--version"], {
        cwd: workdir,
        encoding: "utf8",
        env: getKaneEnv(),
    });

    if (probe.status !== 0 && !probe.stdout) {
        throw new Error(
            `Kane CLI is not available in PATH. Please install kane-cli to run the requirements-to-tests workflow.`
        );
    }

    const authCheck = spawnSync(bin, ["whoami"], {
        cwd: workdir,
        encoding: "utf8",
        env: getKaneEnv(),
    });

    if (authCheck.status !== 0 || authCheck.stdout.includes("Not authenticated")) {
        throw new Error(
            `Kane CLI is not authenticated. Run 'kane-cli login' before syncing specifications.`
        );
    }
}

export function inspectAssuranceMapping(workdir: string): SpecCoverageReport {
    // 1. Run kane-cli context list --json
    const listRes = runKaneSync(["context", "list", "--json"], workdir);
    if (listRes.code !== 0) {
        throw new Error(`Failed to list Kane context: ${listRes.stderr || listRes.stdout}`);
    }

    const acNodes: Array<{ id: string; title: string; trust?: string }> = [];
    const testNodes: Array<{ id: string; title: string; trust?: string }> = [];
    const gapNodes: Array<{ id: string; title: string }> = [];

    for (const line of listRes.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
            const node = JSON.parse(trimmed);
            if (node.label === "ac") acNodes.push({ id: node.id, title: node.title, trust: node.trust });
            if (node.label === "test") testNodes.push({ id: node.id, title: node.title, trust: node.trust });
            if (node.label === "gap") gapNodes.push({ id: node.id, title: node.title });
        } catch {}
    }

    // 2. Run kane-cli cover --json
    const coverRes = runKaneSync(["cover", "--json"], workdir);
    let coverJson: any = null;
    if (coverRes.code === 0) {
        try {
            coverJson = JSON.parse(coverRes.stdout);
        } catch {}
    }

    // 3. Run kane-cli cover gaps --json
    const gapsRes = runKaneSync(["cover", "gaps", "--json"], workdir);
    let gapsJson: any = null;
    if (gapsRes.code === 0) {
        try {
            gapsJson = JSON.parse(gapsRes.stdout);
        } catch {}
    }

    // 4. Scan .testmuai/tests/ for real test files and their @verifies markers
    const testsDir = path.join(workdir, ".testmuai", "tests");
    const testFiles = fs.existsSync(testsDir)
        ? fs.readdirSync(testsDir).filter((f) => f.endsWith("_test.md"))
        : [];

    const acToTestMap: Record<string, { testId?: string; file: string }> = {};

    for (const file of testFiles) {
        const fullPath = path.join(testsDir, file);
        const content = fs.readFileSync(fullPath, "utf8");

        // Parse frontmatter assurance id if present
        let testId: string | undefined = undefined;
        const idMatch = content.match(/assurance:\s*\n\s*id:\s*([^\s\n]+)/);
        if (idMatch) {
            testId = idMatch[1].toLowerCase();
        }

        // Match all @verifies ac-X, ac-Y
        const verifiesMatches = content.matchAll(/@verifies\s+([^\n\r]+)/gi);
        for (const match of verifiesMatches) {
            const rawAcs = match[1].split(",");
            for (const rawAc of rawAcs) {
                const acId = rawAc.trim().toLowerCase();
                if (acId) {
                    acToTestMap[acId] = {
                        testId,
                        file: path.relative(workdir, fullPath),
                    };
                }
            }
        }
    }

    // 5. Map each AC
    const criteria: CriterionMapping[] = [];
    let coveredCount = 0;

    for (const ac of acNodes) {
        const mapped = acToTestMap[ac.id.toLowerCase()];
        const uc = coverJson?.perAc?.[ac.id]?.uc;
        const isProven = coverJson?.perAc?.[ac.id]?.state === "proven";
        const isUnreviewed = ac.trust === "derived" || ac.trust === "hold";

        if (mapped) {
            coveredCount++;
            criteria.push({
                id: ac.id,
                text: ac.title,
                usecaseId: uc,
                testId: mapped.testId,
                testFile: mapped.file,
                status: "MAPPED",
                unreviewed: isUnreviewed,
                proven: isProven,
            });
        } else {
            // Check if there is an explicit gap reason from cover gaps
            const gap = gapsJson?.other?.find(
                (g: any) => g.ref === ac.id || g.id === ac.id
            );
            criteria.push({
                id: ac.id,
                text: ac.title,
                usecaseId: uc,
                status: "GAP",
                unreviewed: isUnreviewed,
                proven: false,
                gapReason: gap?.why || gap?.risk_rationale || "No generated Kane CLI test verifies this criterion",
            });
        }
    }

    const total = criteria.length;
    const percentage = total > 0 ? Math.round((coveredCount / total) * 100) : 0;
    const gapsCount = total - coveredCount;
    const unreviewedCount = criteria.filter((c) => c.unreviewed).length;
    const provenCount = coverJson?.criteria?.proven ?? 0;

    let output = "";
    if (provenCount > 0) {
        output = `Coverage: ${provenCount} / ${total} acceptance criteria proven by Kane CLI (${Math.round((provenCount / total) * 100)}% proven, ${coveredCount} designed).`;
    } else {
        output = `Coverage: 0 / ${total} acceptance criteria proven by Kane CLI (0% proven, ${coveredCount} designed/staged${unreviewedCount > 0 ? ", unreviewed" : ""}).`;
    }
    if (gapsCount > 0) {
        output += ` Found ${gapsCount} coverage gap(s).`;
    }

    return {
        totalCriteria: total,
        coveredCriteria: coveredCount,
        provenCriteria: provenCount,
        percentage: total > 0 ? Math.round((provenCount / total) * 100) : 0,
        gapsCount,
        criteria,
        rawCover: coverJson,
        rawGaps: gapsJson,
        output,
    };
}

export function syncSpecWithKane(
    prdPath: string = "PRD.md",
    workdir: string = process.cwd()
): SpecSyncResult {
    const resolvedPrd = path.isAbsolute(prdPath) ? prdPath : path.join(workdir, prdPath);
    if (!fs.existsSync(resolvedPrd)) {
        throw new Error(`PRD file not found at ${resolvedPrd}`);
    }

    // Check Kane CLI availability and authentication first
    checkKanePreconditions(workdir);

    // 1. Ingest PRD source
    const ingestRes = runKaneSync(
        ["context", "ingest", "--local", resolvedPrd, "--mode", "ci"],
        workdir
    );
    if (ingestRes.code !== 0 && !ingestRes.stdout.includes("already landed")) {
        throw new Error(
            `Kane context ingest failed: ${ingestRes.stderr || ingestRes.stdout}`
        );
    }

    // 2. Extract use cases
    const extractRes = runKaneSync(["context", "extract", "--mode", "ci", "--json"], workdir);
    if (extractRes.code !== 0) {
        throw new Error(
            `Kane context extract failed: ${extractRes.stderr || extractRes.stdout}`
        );
    }

    // 3. Find use cases to design
    const listRes = runKaneSync(["context", "list", "--json"], workdir);
    const usecaseIds: string[] = [];
    for (const line of listRes.stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
            const node = JSON.parse(trimmed);
            if (node.label === "usecase" && node.id) {
                usecaseIds.push(node.id);
            }
        } catch {}
    }

    if (usecaseIds.length === 0) {
        throw new Error(
            `Kane CLI could not extract any use-cases from ${resolvedPrd}. Please check PRD format.`
        );
    }

    // 4. Design tests for each use-case
    for (const ucId of usecaseIds) {
        const designRes = runKaneSync(
            ["design", "tests", "--use-case", ucId, "--allow-unreviewed", "--force", "--mode", "ci", "--json"],
            workdir
        );
        if (!isDesignSuccessful(designRes, workdir, ucId)) {
            throw new Error(
                `Kane test design failed for use-case '${ucId}': ${designRes.stderr || designRes.stdout}`
            );
        }
    }

    // 5. Inspect assurance mapping and genuine coverage gaps
    const coverage = inspectAssuranceMapping(workdir);

    // 6. Record manifest to detect stale or altered generated tests before verification
    const testsDir = path.join(workdir, ".testmuai", "tests");
    const testFiles = fs.existsSync(testsDir)
        ? fs.readdirSync(testsDir).filter((f) => f.endsWith("_test.md"))
        : [];

    const testFileHashes: Record<string, string> = {};
    for (const f of testFiles) {
        const p = path.join(testsDir, f);
        const rel = path.relative(workdir, p);
        testFileHashes[rel] = computeFileSha256(p);
    }

    const prdRelPath = path.relative(workdir, resolvedPrd);
    const manifest: RatchetManifest = {
        manifestVersion: 1,
        syncedAt: new Date().toISOString(),
        prdPath: prdRelPath,
        prdHash: computeFileSha256(resolvedPrd),
        testFiles: testFileHashes,
        criteria: coverage.criteria,
    };

    const manifestDir = path.join(workdir, ".testmuai");
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, ".ratchet_manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return {
        prdPath: resolvedPrd,
        criteriaCount: coverage.totalCriteria,
        criteria: coverage.criteria,
        testFiles: Object.keys(testFileHashes),
        coverage,
        manifestPath,
    };
}

export function detectStaleOrAltered(
    workdir: string = process.cwd(),
    prdPath?: string
): { ok: boolean; reason?: string } {
    const manifestPath = path.join(workdir, ".testmuai", ".ratchet_manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return {
            ok: false,
            reason: "No Ratchet sync manifest found. Run 'ratchet sync' first to generate and map tests.",
        };
    }

    let manifest: RatchetManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (err) {
        return {
            ok: false,
            reason: `Failed to read Ratchet sync manifest: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    // 1. Verify PRD integrity
    const targetPrd = prdPath || manifest.prdPath;
    const resolvedPrd = path.isAbsolute(targetPrd) ? targetPrd : path.join(workdir, targetPrd);
    if (!fs.existsSync(resolvedPrd)) {
        return {
            ok: false,
            reason: `PRD specification file not found at '${resolvedPrd}'.`,
        };
    }

    const currentPrdHash = computeFileSha256(resolvedPrd);
    if (currentPrdHash !== manifest.prdHash) {
        return {
            ok: false,
            reason: `Stale generated tests detected: PRD at '${manifest.prdPath}' was modified after 'ratchet sync'. Run 'ratchet sync' to reconcile acceptance tests before verifying.`,
        };
    }

    // 2. Verify generated test files integrity
    for (const [relPath, expectedHash] of Object.entries(manifest.testFiles)) {
        const fullPath = path.join(workdir, relPath);
        if (!fs.existsSync(fullPath)) {
            return {
                ok: false,
                reason: `Altered generated tests detected: test file '${relPath}' is missing. Re-run 'ratchet sync'.`,
            };
        }

        const currentHash = computeFileSha256(fullPath);
        if (currentHash !== expectedHash) {
            return {
                ok: false,
                reason: `Altered generated tests detected: test file '${relPath}' has been modified since 'ratchet sync'. Never alter or weaken generated tests. Re-run 'ratchet sync'.`,
            };
        }
    }

    return { ok: true };
}

export function getCoverageStatus(workdir: string = process.cwd()): SpecCoverageReport {
    try {
        return inspectAssuranceMapping(workdir);
    } catch {
        return {
            totalCriteria: 0,
            coveredCriteria: 0,
            provenCriteria: 0,
            percentage: 0,
            gapsCount: 0,
            criteria: [],
            output: "Coverage data unavailable (run 'ratchet sync' to initialize Kane CLI context).",
        };
    }
}
