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
        if (
            designRes.code !== 0 &&
            !designRes.stdout.includes("complete") &&
            !designRes.stdout.includes("already designed")
        ) {
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
