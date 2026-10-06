# Dependencies and license scope

This candidate uses Node.js built-in modules and has no third-party npm runtime or development dependencies. Node.js 22.16.0 or newer is required. Use a maintained Node.js release with current security fixes for regular use; a minimum-version CI job checks API compatibility only.

## Runtime inventory

| Component | Role | Distribution and license boundary |
| --- | --- | --- |
| Node.js | JavaScript runtime, filesystem, process, test runner, cryptography | Installed separately; not bundled by this repository. Its distribution includes Node.js and third-party license notices. |
| `node:sqlite` | SQLite storage and database-enforced read-only connections | Included in Node.js; no native npm add-on or external SQLite executable is required. |
| Local MCP adapter | Narrow JSON-RPC stdio interface for three read tools | New implementation in this repository, under its MIT license. |
| GitHub Actions | Hosted clean-install and test environments | CI service, not an application runtime dependency. Actions retain their own licenses. |

`node:sqlite` was introduced in Node.js 22.5.0 and stopped requiring the experimental flag in 22.13.0, while remaining experimental in that release line. `DatabaseSync(..., { readOnly: true })` rejects opening a missing database and disables database writes. Newer methods have separate introduction versions: for example, `sqlite.backup` requires at least 22.16.0. Avoid assuming every method in current Node.js documentation exists on the declared minimum. See the [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html) and the [versioned 22.13.0 documentation](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html).

The official MCP SDK was evaluated but is neither installed nor copied into this candidate. Its releases and licenses are therefore not inherited by this repository. The earlier application dependency `xlsx` and its dependency tree are also not inherited. Any future dependency addition must update the manifest, lockfile, license inventory, and clean-install checks together.

## License decision

The owner selected MIT for this candidate's new code, documentation, templates, and fictional demo. The canonical text is in [LICENSE](../LICENSE); the [Open Source Initiative MIT text](https://opensource.org/license/mit) describes the notice-preservation condition and warranty disclaimer.

This choice does not assert that any earlier private source repository was MIT-licensed, and does not relicense its code or data. The source inventory did not establish a license grant for that earlier repository. No original repository history, original files, real project records, or third-party package source is included. Future copied code must carry verified provenance and any required attribution.

MIT keeps reuse conditions compact. Apache-2.0 was considered as an alternative because it includes an explicit contributor patent grant, related patent-termination conditions, and additional redistribution requirements. It was not selected for this candidate. See the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

If distributing a Node.js binary with a future packaged application, retain the notices required by that binary's distribution. This source-only candidate does not bundle Node.js or change its license. See [Node.js LICENSE](https://github.com/nodejs/node/blob/main/LICENSE).

## MCP compatibility boundary

The adapter targets the MCP `2025-11-25` protocol revision over local stdio. It exposes only `read_project_overview`, `read_task`, and `read_recent_changes`. This is a deliberately limited reference implementation, not an official SDK or a claim of full MCP conformance. Application execution events are ordinary stored records; they are unrelated to MCP's experimental task execution extension.

The implementation and its tests must preserve these protocol rules:

- Use UTF-8 JSON-RPC messages, one per line. Keep stdout reserved for protocol messages; send diagnostics to stderr. See [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
- Negotiate using `initialize`, return the selected supported protocol version, server information, and only implemented capabilities, then handle `notifications/initialized`. If the requested version is unsupported, return a supported version for the client to accept or disconnect. See [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
- Advertise `tools`, return the fixed catalog through `tools/list`, and validate both the `tools/call` envelope and tool arguments. Unknown tools and malformed envelopes use protocol errors; execution and domain validation failures use tool results with `isError: true`. Structured results should also have serialized JSON text content. Tool annotations are descriptive hints, not a security boundary. See [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
- Reply to a `ping` request promptly with an empty result object and the same request ID. See [ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping).
- Do not reply to notifications. Preserve valid request IDs in responses, validate the JSON-RPC envelope, and reject unsupported methods without executing a tool. See [base protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic).

The actual read-only boundary is the fixed read-tool dispatch plus a SQLite read-only connection. The MCP process must not initialize or migrate a database or write diagnostic files. It does not prove that unrelated native tools or other processes cannot write to the filesystem. Real-client interoperability and hosted CI results must be reported separately from local protocol tests.

## Clean-install verification

Use separate Linux and Windows hosted jobs, with minimum Node.js 22.16.0 and a maintained Node.js 24.x release. Disable dependency caching for the initial verification, check out only this repository, run `npm ci`, then the repository tests and fictional-demo smoke test. A committed empty-dependency lockfile still lets `npm ci` verify the manifest/lockfile relationship. Prefer Node.js test scripts to platform-specific shell commands. See [GitHub's Node.js CI guide](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [matrix jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations), and [setup-node](https://github.com/actions/setup-node).

Hosted runners provide a second environment without another physical computer. Private-repository jobs consume the account's included Actions minutes before any applicable charges; no paid runner or billing change is required by this repository. A workflow file alone is not a passing run. Record actual run links and results only after execution. See [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
