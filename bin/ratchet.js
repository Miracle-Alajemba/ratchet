#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.resolve(dir, "../node_modules/.bin/tsx");
const index = path.resolve(dir, "../src/index.ts");

const child = spawn(process.execPath, [tsx, index, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
});

child.on("exit", (code) => {
    process.exit(code ?? 0);
});
