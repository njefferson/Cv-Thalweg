#!/usr/bin/env node
/**
 * hub-pin-check.mjs — the hub commit is written in two files and they must
 * never disagree.
 *
 *   node tools/hub-pin-check.mjs
 *
 * `.doctrine-sync` records the hub commit this repository has RECONCILED with;
 * `doctrine-sync.mjs --adopt` moves it, and moving it is an assertion that
 * somebody read the drift. The pin in the gates workflow's
 * `uses: .../hub-gates.yml@<sha>` line is the commit CI RUNS THE HUB'S GATES
 * FROM, because the shared gates — privacy, quotes, the no-grid rule, the
 * branch guard's artefact check — are the hub's files and a runner has to
 * fetch them from somewhere.
 *
 * **They are the same fact and they drift silently.** Adopting is one command
 * and editing a workflow is another, and the second one is easy to skip because
 * nothing about the tree looks different afterwards. What it costs: CI keeps
 * running the hub's gates from an older commit, every one of them goes green,
 * and a rule added to the hub in between is enforced NOWHERE while the marker
 * in this repository says it has been read and applied.
 *
 * That is hub LESSONS §117 almost exactly — a CI step pinned to a commit from
 * before the gate it runs existed — and it happened here on the very commit
 * that adopted §146: the marker moved and the pin did not, and it was caught by
 * hand rather than by anything that would catch it next time.
 *
 * A pin BEHIND the marker is the failure. A pin AHEAD of it is also refused:
 * that is CI enforcing rules this repository has not reconciled with, which is
 * a different problem with the same fix — read the drift, then adopt.
 *
 * ## Why this is NOT a hub gate, which is the interesting part
 *
 * The hub's shared gates live in the hub and take `--repo .`, precisely so five
 * divergent copies cannot exist. This one cannot follow that rule, and the
 * reason is the same circularity it exists to break: **CI fetches the hub AT
 * that pin, so a gate that validates the pin would be fetched at the very commit
 * it is checking.** A pin left behind far enough would check out a hub that does
 * not contain this file, and the step would fail with a missing module rather
 * than a diagnosis — which is hub LESSONS §117 one level up, wearing the costume
 * of its own fix.
 *
 * So it is repo-local on purpose, it reads only files in this repository, and it
 * needs the hub for nothing. Every sibling that pins the hub owes its own copy
 * for the same reason, and that is stated in §117 rather than left to be
 * rediscovered.
 *
 * Wired as a `.branch-guard also=` entry, so it runs on every commit rather
 * than when somebody remembers — and for the same reason: a commit must not
 * depend on the hub being checked out beside this repository.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MARKER = '.doctrine-sync';
const WORKFLOW = '.github/workflows/gates.yml';

const read = (relative) => {
  try {
    return readFileSync(join(REPO, relative), 'utf8');
  } catch {
    return null;
  }
};

console.log('\n=== the hub pin · Cv-Thalweg ===\n');

const markerSource = read(MARKER);
const workflowSource = read(WORKFLOW);
const failures = [];

// A MISSING FILE IS A FAILURE, never a skip. A check that quietly stops running
// is the fail-open this whole family of hooks exists because of.
if (markerSource === null) failures.push(`${MARKER} is missing — this repository has reconciled with nothing`);
if (workflowSource === null) failures.push(`${WORKFLOW} is missing — nothing runs the hub's gates`);

if (failures.length === 0) {
  const marker = markerSource.trim();
  // THE PIN MOVED HOUSE ON 2026-08-29. It used to be `HUB_SHA:`, an env var
  // feeding a hand-written `actions/checkout` of the hub inside the gates job.
  // The gates are now CALLED — `uses: .../hub-gates.yml@<sha>` — so the ref
  // after the `@` is the same fact in its new place, and the hub works out
  // which commit to run the gates from by reading that ref off its own
  // `github.workflow_ref`. One pin instead of two, which is this file's own
  // argument applied to itself.
  const pin = /hub-gates\.yml@([0-9a-f]{40})\s*$/m.exec(workflowSource)?.[1];

  if (!/^[0-9a-f]{40}$/.test(marker)) {
    failures.push(`${MARKER} reads "${marker}", which is not a full commit SHA`);
  } else if (pin === undefined) {
    // Anchored on a full 40-character SHA on its own line, so an abbreviated
    // pin or a branch name fails LOUDLY rather than being read as absent.
    failures.push(`${WORKFLOW} does not call hub-gates.yml at a full 40-character commit SHA`);
  } else if (pin !== marker) {
    failures.push(
      `the doctrine marker is ${marker.slice(0, 7)} and CI checks the hub out at ${pin.slice(0, 7)}`,
    );
  } else {
    console.log(`  ok    ${MARKER} and ${WORKFLOW} both read ${marker.slice(0, 7)}`);
    console.log('  ok    CI runs the hub gates from the commit this repository has reconciled with');
    console.log('\nThe pin moves with the marker, because they are the same fact.\n');
    process.exit(0);
  }
}

for (const failure of failures) console.log(`  FAIL  ${failure}`);
console.error(
  '\nThe hub commit is written in two places and they have drifted. CI checks the hub\n' +
    'out at the pin in the `uses:` line to run the shared gates, so a pin left behind\n' +
    'means those gates go\n' +
    'green while running checks that never heard of the rules this repository has\n' +
    'already adopted. Move them together:\n\n' +
    '  node ../noahjefferson/doctrine-sync.mjs --repo . --adopt\n' +
    `  then move the hub-gates.yml pin in ${WORKFLOW} to the same commit\n`,
);
process.exit(1);
