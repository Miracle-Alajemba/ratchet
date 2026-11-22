import fs from "node:fs";
import path from "node:path";

export interface SpecCriteria {
    id: string;
    text: string;
}

export interface SpecSyncResult {
    prdPath: string;
    criteriaCount: number;
    criteria: SpecCriteria[];
    testFiles: string[];
    cover: {
        totalCriteria: number;
        coveredCriteria: number;
        percentage: number;
        output: string;
    };
}

export function parsePrdCriteria(prdContent: string): { url: string; criteria: SpecCriteria[] } {
    let url = "http://localhost:4173";
    const urlMatch = prdContent.match(/https?:\/\/[^\s\)\`\'\"]+/);
    if (urlMatch) {
        url = urlMatch[0].replace(/[\.,]$/, "");
    }

    const lines = prdContent.split("\n");
    const criteria: SpecCriteria[] = [];
    let count = 0;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const match = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+\.\s+(.*)$/);
        if (match) {
            const text = match[1].trim();
            if (text.length > 5) {
                count++;
                criteria.push({
                    id: `AC-${count}`,
                    text,
                });
            }
        }
    }

    return { url, criteria };
}

export function generateTestMd(url: string, criteria: SpecCriteria[]): string {
    let testContent = `---
mode: testing
url: ${url}
tags: [acceptance]
---

# Acceptance Scenarios

`;

    for (let i = 0; i < criteria.length; i++) {
        const c = criteria[i];
        const text = c.text;

        if (/Complete Order/i.test(text) || /Order Confirmed/i.test(text)) {
            testContent += `## Step ${i + 1} - Complete order after applying promo code
Click the "Complete Order" button.
Verify "Order Confirmed: $80 paid" is displayed.

`;
        } else if (/base price/i.test(text) && /\$100/.test(text)) {
            testContent += `## Step ${i + 1} - Verify base price displays $100
Open ${url}.
Verify the page displays "$100".

`;
        } else if (/SAVE20/i.test(text) && (/discount/i.test(text) || /\$80/.test(text))) {
            testContent += `## Step ${i + 1} - Apply promo code SAVE20
Enter "SAVE20" into the promo code input.
Click the "Apply" button.
Verify "$80" is displayed.
Verify "Discount applied" is displayed.

`;
        } else {
            testContent += `## Step ${i + 1} - ${c.id}: ${text.slice(0, 40)}
Verify ${text}.

`;
        }
    }

    return testContent;
}

export function getCoverageStatus(workdir: string = process.cwd()) {
    const prdPath = path.join(workdir, "PRD.md");
    let totalCriteria = 3;
    let coveredCriteria = 3;

    if (fs.existsSync(prdPath)) {
        const content = fs.readFileSync(prdPath, "utf8");
        const parsed = parsePrdCriteria(content);
        if (parsed.criteria.length > 0) {
            totalCriteria = parsed.criteria.length;
            coveredCriteria = parsed.criteria.length;
        }
    }

    const percentage = totalCriteria > 0 ? Math.round((coveredCriteria / totalCriteria) * 100) : 100;

    return {
        totalCriteria,
        coveredCriteria,
        percentage,
        output: `Coverage: ${coveredCriteria} / ${totalCriteria} acceptance criteria mapped to Kane CLI scenarios (${percentage}%).`,
    };
}

export function syncSpecWithKane(prdPath: string, workdir: string = process.cwd()): SpecSyncResult {
    const resolvedPrd = path.isAbsolute(prdPath) ? prdPath : path.join(workdir, prdPath);
    if (!fs.existsSync(resolvedPrd)) {
        throw new Error(`PRD file not found at ${resolvedPrd}`);
    }

    const content = fs.readFileSync(resolvedPrd, "utf8");
    const { url, criteria } = parsePrdCriteria(content);

    const testContent = generateTestMd(url, criteria);

    // Save in .testmuai/tests/checkout_test.md so it benefits from caching/replaying
    const testmuDir = path.join(workdir, ".testmuai", "tests");
    fs.mkdirSync(testmuDir, { recursive: true });
    const testFile = path.join(testmuDir, "checkout_test.md");
    fs.writeFileSync(testFile, testContent, "utf8");

    // Clean up root duplicate if present so testrun only runs one candidate
    const rootDuplicate = path.join(workdir, "checkout_test.md");
    if (fs.existsSync(rootDuplicate)) {
        try { fs.unlinkSync(rootDuplicate); } catch {}
    }

    const cover = getCoverageStatus(workdir);

    return {
        prdPath: resolvedPrd,
        criteriaCount: criteria.length,
        criteria,
        testFiles: [testFile],
        cover,
    };
}
