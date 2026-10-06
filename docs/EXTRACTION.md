# Core extraction and generalization

This candidate is a small reference implementation of context continuity for long-running projects. It preserves useful behaviors from an earlier local implementation without importing its database, history, governance system, or project documents.

The target is `v0.1.0-alpha`. This document records the extraction decisions; it is not a production-readiness claim or proof that every validation environment has passed.

## Scope

The Core contains:

- Stable task IDs and recorded task status, owner, checkpoint, next action, and update time.
- SQLite persistence with execution events and duplicate-registration checks.
- A local worker write path for updates to its assigned task.
- Three read-only MCP tools: `read_project_overview`, `read_task`, and `read_recent_changes`.
- Explicit freshness semantics and separate decision, state, and evidence records.
- Project Instructions and fresh-chat blind-test templates.
- A wholly fictional travel-planning example, “晴雨行程”.

The extraction is a small reimplementation of these behaviors. It is not a copy of the earlier runtime with selected features disabled.

## Reuse assessment

| Earlier module | Useful behavior | Candidate treatment |
| --- | --- | --- |
| `store` | Explicit database location, read-only database connection, transactions, task and event storage | Reimplement in a minimal schema using built-in SQLite. Do not import an existing database or migration history. |
| `runtime` | Stable identity, duplicate checks, revision checks, idempotent operations, atomic state and event writes | Reimplement the Core operations without coordination, review, or approval machinery. |
| `runtime` | Read time is separate from the time a fact was recorded; bounded reads | Preserve the distinction in the read contract and documentation. |
| `runtime` | Decisions have their own meaning and references | Keep decisions separate from execution status and evidence. Recording a decision must not imply external authorization. |
| `worker` | A writer bound to one task and actor | Provide a small local writer. Explain the trusted-local-process boundary. |
| `mcp-server` | An explicit tool allowlist and validated arguments | Expose only the three Core reads through local standard input/output. |
| `mcp-server` | Database opened read-only | Keep reads free of application state writes, automatic initialization, and implicit diagnostic files. |

## Generalization checklist

| Concern | Candidate rule |
| --- | --- |
| Filesystem locations | Default to a path relative to the working directory; support explicit configuration. Never ship a maintainer's machine path. |
| Database | Initialize a new local database. Ignore generated databases and sidecar files in version control. |
| Task identity | Use a task ID independent of a chat, process, machine, or worker session. Keep the same ID when work resumes. |
| Actors | Use fictional actor labels in examples. An actor label is a consistency check, not authentication. |
| Duplicate work | An identical initial registration can be retried without another registration event. Reject conflicting task IDs or duplicate keys; do not infer uniqueness from titles alone. |
| Events | Record successful state changes atomically with their events. Do not import earlier event history. |
| Decisions | Store scoped decision records separately. Do not carry earlier project decisions into the example. |
| Evidence | Use compact references and descriptions. Do not ingest private transcripts, logs, or credentials. |
| Dependencies | Use Node.js built-ins, including `node:sqlite`; no third-party runtime packages or MCP SDK are required. |
| Platform | Require Node.js 22.16 or newer. Use portable path handling and commands suitable for Windows and Linux. |
| Examples | Ship only the fictional travel-planning fixtures under `examples/sun-rain/`. |
| Instructions | Provide reusable templates rather than exporting instructions from an existing project. |
| Packaging | Ship source, tests, documentation, templates, and fictional fixtures. Generated state and local validation workspaces stay outside the release payload. |

The earlier implementation did not establish a reusable license grant through an identifiable license file or source headers in the inspected scope. The owner has explicitly selected MIT for this candidate's new implementation. That decision does not relicense the earlier repository. A dependency-free implementation does not by itself resolve ownership questions; future imported code still requires verified rights and attribution. See LICENSE and docs/DEPENDENCIES.md.

## Directory design

```text
src/
  config.mjs          # local configuration and database location
  store.mjs           # SQLite schema, mutations, and read APIs
  worker.mjs          # local task-bound write interface
  cli.mjs             # initialization and local operator/worker commands
  protocol.mjs        # MCP schemas, validation, and read dispatch
  mcp-server.mjs      # local stdio JSON-RPC transport
examples/
  sun-rain/
    demo.mjs          # fictional initialization and walkthrough
    *.json            # fictional command inputs
templates/           # Project Instructions and blind-test prompts
docs/                # architecture, extraction, and release guidance
test/                # isolated behavior and protocol checks
scripts/             # privacy and release validation helpers
.github/workflows/   # hosted clean-install and test matrix
```

The module comments describe responsibilities, not a separate promise of every internal export. Consult the CLI help and README for runnable commands.

## Excluded features

These features are not implemented or required by the Core:

- Strict reviewer native-tool audits or proofs about arbitrary shell behavior.
- Phase A/B/C automatic admission and command-admission registries.
- Post-terminal reviewer reconciliation and automatic review approval.
- Multi-agent dispatch, lease coordination, automatic continuation, or unattended release gates.
- Project-specific governance, business rules, product facts, data collection, or production data adapters.
- A remote HTTP MCP connector, hosted authentication, or account management.

They may be discussed as experimental ideas, but no experimental implementation is bundled. Core validation does not validate any of these features.

## Reproducibility and release evidence

Use two distinct validation stages:

1. **Independent directory on the same computer.** Create a fresh clone containing only candidate files, install from the lockfile, run the tests, initialize a new database, run the fictional example, and exercise the MCP reader. This detects omitted files, accidental references to the original workspace, and reliance on existing local state. It still shares the same operating system, installed software, and hardware.
2. **GitHub-hosted runners.** Run clean-install and tests on a Linux and Windows matrix. This provides a separate environment and checks portability. A workflow file is only a plan: report hosted validation as passed only after the actual run succeeds for the exact candidate revision.

A fresh-chat blind test is a third, different check: the reader must recover the task, owner, checkpoint, next action, decisions, evidence, and unknowns from the state channel without being given those answers in its prompt. An automated readback does not prove that a newly opened chat completed that test.

Before changing repository visibility to public, verify the candidate payload and history for private data and secrets, make the license choice explicit, and review the clean-install results. A scan is evidence about its checks and inputs; it is not a guarantee that all possible private material has been detected.
