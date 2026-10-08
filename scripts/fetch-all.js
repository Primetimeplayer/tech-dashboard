// Runs every source fetch, then the optional summarizer.
// News has to succeed. A later source (papers, reviews, Reddit) must not
// discard a fresh news file by failing the whole command before the
// workflow can commit public/data.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const steps = [
  { script: 'fetch-news.js', required: true },
  { script: 'fetch-papers.js', required: false },
  { script: 'fetch-reviews.js', required: false },
  { script: 'fetch-reddit.js', required: false },
  { script: 'summarize.js', required: false },
];

function run(script) {
  const file = path.join(dir, script);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

let failed = false;
for (const step of steps) {
  const code = await run(step.script);
  if (code !== 0) {
    console.error(`[fetch-all] ${step.script} exited ${code}`);
    if (step.required) failed = true;
  }
}

process.exit(failed ? 1 : 0);
