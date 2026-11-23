#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.resolve(dir, "../dist/index.js");

if (fs.existsSync(distIndex)) {
    await import(distIndex);
} else {
    const { spawn } = await import("node:child_process");
    const tsx = path.resolve(dir, "../node_modules/.bin/tsx");
    const srcIndex = path.resolve(dir, "../src/index.ts");
    const child = spawn(process.execPath, [tsx, srcIndex, ...process.argv.slice(2)], {
        stdio: "inherit",
        env: process.env,
    });
    child.on("exit", (code) => {
        process.exit(code ?? 0);
    });
}
