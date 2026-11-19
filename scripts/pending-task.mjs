#!/usr/bin/env node
const [task, stage] = process.argv.slice(2);

if (task === undefined || stage === undefined) {
  console.error("usage: node scripts/pending-task.mjs <task> <roadmap-stage>");
  process.exit(1);
}

console.error(`${task}: intentionally fails until ${stage} implements it`);

process.exit(1);
