# Dependency maintenance

`claude-test-progress` ships the `test-progress` plugin without installing test
frameworks into the user's application. The collector still supports Node
**14.0.0 and newer**. Files under `tests/dependencies/` are CI fixture inputs,
not plugin runtime dependencies. The workspace configuration and the optional
registry use `schemaVersion: 1`, with zero or multiple modules
identified by safe IDs. Only workspace declarations activate modules. Runtime
is explicit (`inherit` or `node-project`), independent of ID or language;
`command` and `env` replace whole template fields.

Use `start/list/status/logs/cancel` with `--module id|all` in the collector CLI,
`-Module` in its PowerShell bootstrap, and explicit verbs in `/test-progress`.
Starts are always explicit, by ID or `all`.
Discovery is read-only for configuration, does not execute app resolvers, and
publishes neither command nor env. See [USAGE](USAGE.md) for registry location,
the 1 MiB source limit and CLI-only `--config` scope.

The tested matrix is in [COMPATIBILITY](COMPATIBILITY.md). Workflow
configuration below describes intended coverage; the result for a commit is its
hosted run. How to reproduce each gate is in [VALIDATION](VALIDATION.md).

## Configured update coverage

[Dependabot configuration](../.github/dependabot.yml) checks on Mondays at
09:00 America/Sao_Paulo. Each of its ten update entries allows three open
version-update PRs. CI jobs with different compatibility limits have their own
entry. Minor and patch version updates are grouped within each entry; major
updates remain individual PRs. Security updates remain individual and are not
delayed by the weekly version-update schedule or governed by its PR limit.
There is no automerge.

`ignore` rules keep each CI job inside the supported matrix:

| Inputs | Ignored |
| --- | --- |
| Maven | JUnit BOM and `org.junit.platform:*` 6+ (JUnit 5 stays the contract) |
| `python38` | pytest 8.4+ (no Python 3.8 support) |
| `rspec` | `rspec*` 3.14+ (contract is RSpec Core 3.13.x) |
| `rails72` | Rails 7.3+ and every Minitest update (the job pins the 5.20.0 floor) |
| `rails80` / `rails81` | Rails outside the job's series; Minitest 6+ |
| `angular9` | Everything: frozen Node 12 / npm 6 toolchain with a lockfileVersion 1 lock |
| `angular18` | Majors; TypeScript 5.6+; zone.js 0.15+ (Angular 18 peers) |

Dependency and version `ignore` conditions also suppress **security** PRs for
the matched dependencies. For `angular9` this is deliberate: every available fix
requires a newer Angular builder. Its alerts stay open; review and dismiss them
explicitly as fixture-only risk instead of suppressing them silently.

| Ecosystem | Inputs | Consumer |
| --- | --- | --- |
| GitHub Actions | `.github/workflows/*.yml` | Action references in all workflows, including future release/integration workflows |
| Maven | `adapters/junit/pom.xml`, `tests/dependencies/junit/pom.xml` | Listener build and disposable JUnit/Surefire application |
| pip | `tests/dependencies/python38/requirements.txt`, `python314/requirements.txt` | Quality: Python 3.8 / Node 14.0.0 and Python 3.14 / Node 24 |
| Bundler | `tests/dependencies/rspec/Gemfile` and lock | RSpec: Ruby 3.1, 3.4 and 4.0 |
| Bundler | `tests/dependencies/rails72`, `rails80`, `rails81` Gemfiles and locks | Rails 7.2 / Ruby 3.3; Rails 8.0 and 8.1 / Ruby 3.4 |
| npm | `tests/dependencies/angular9` and `angular18` package manifests/locks | Angular CLI/Karma/browser fixtures; no npm updates for the dependency-free root package |

The initial Python/Ruby framework versions match the previous inline installations.
Python requirements pin pytest; **Python transitive dependencies are not
locked**. Bundler locks include resolved transitive gems and Linux/generic Ruby
platforms. Frozen installs reject a stale Gemfile/lock pair. Gems install in the
runner's temporary directory. Tests receive that gem path without inheriting
the CI `BUNDLE_GEMFILE`, so their generated application Gemfiles still exercise
application-controlled Bundler boot. Rails and Minitest fixture versions come
from the installed lock; the workflow rejects a Rails version outside its
matrix series.

A generated fixture Gemfile alone is not a versioned dependency manifest.
Dependabot now maintains the committed install inputs, but it does not rewrite
compatibility assumptions inside fixture generators. For example,
`scripts/check-ruby.py` currently exercises a `~> 3.13.0` application bundle;
`scripts/check-rails.py` has Minitest, Capybara and Selenium constraints. A major
upgrade can therefore require a separate adapter/fixture change and an explicit
matrix decision. Review an oldest-supported-runtime upgrade especially closely:
new pytest releases may not support Python 3.8. A failing compatibility job is
not a reason to silently raise the collector's Node minimum.

The npm entry covers only real fixture dependencies; the private root package
still has no runtime dependencies. npm locks are generated with the app runtime
and must pass a fresh `npm ci`; the Angular 9 fixture uses npm 6 lock format.
Gitleaks download URLs/checksums, Claude CLI versions, Node/Python/Ruby version
selectors, Bundler's workflow version and runner images are **manual upkeep**.
The adapter workflow below defines Java/browser execution gates separately
from Dependabot; record actual results and the tested SHA before claiming acceptance. An installed Selenium gem does not prove a Rails browser test
ran: the current Rails system fixture still uses `rack_test`. Native Windows
acceptance is separate and remains pending.

## Review and refresh

1. Review upstream release notes, compatibility and the manifest/lock diff.
   Minor/patch grouping does not guarantee a non-breaking change.
2. Keep every remote Action pinned to a full 40-character commit SHA. Verify the
   commit against the upstream repository's release tag, and keep its version
   comment on the same line. Dependabot can update both the SHA and comment.
3. For Ruby changes, update the relevant Gemfile and lock together using Bundler
   2.6.9 and a Ruby from the affected job. For example, from the repository root:

   ```sh
   BUNDLE_GEMFILE=tests/dependencies/rails81/Gemfile bundle lock --update rails
   ```

   Keep the generic `ruby` and x86_64 Linux platforms. Install into an isolated
   `BUNDLE_PATH` and run the affected workflow; do not install fixture frameworks
   globally or add them to the user's plugin setup.
4. For Python changes, install the selected requirements in a disposable venv
   using the corresponding Python version, then run
   `python scripts/check.py --smoke --pytest` and
   `python scripts/check-long-running.py`. Use the matrix's Node version.
5. Run `actionlint` on workflow edits and validate `dependabot.yml` against a
   current Dependabot schema and the official options reference. Schema success
   does not prove the hosted updater accepts or executes the configuration.
6. Require the existing checks and a human review. Do not grant Dependabot a
   ruleset bypass, add unproven required checks, or merge automatically. Major
   upgrades that change supported suites/runtimes need an explicit decision.

The adapter/quality workflows use `pull_request`, `contents: read`,
GitHub-hosted runners, and checkout with `persist-credentials: false`. They do
not consume repository secrets or use `pull_request_target`. This supports the
read-only token restrictions on Dependabot/fork PRs. GitHub may still require a
maintainer to approve a first-time fork's workflow; approve only after review.
A successful ordinary PR is not evidence of an actual Dependabot/fork run.

## Java and Angular integration gates

[Java and Angular adapters](../.github/workflows/adapters.yml) adds selected-suite
jobs without adding globally installed frameworks or new required branch checks:

| Integration | App runtime | Collector runtime |
| --- | --- | --- |
| JUnit 5.14.4 / Surefire 3.6.0 | Temurin Java 17 | Node 14.0.0 |
| JUnit 5.14.4 / Surefire 3.6.0 | Temurin Java 21 | Node 24 |
| Angular 9.1.13 / CLI 9.1.15 / Karma 5.2.3 | Node 12.22.12 | Node 14.0.0 |
| Angular 18.2.14 / CLI 18.2.21 / Karma 6.4.4 | Node 22 | Node 24 |

The collector's minimum remains Node 14.0.0. An app has its own runtime: Angular
9 uses its original Node 12 toolchain, while Angular 18 uses Node 22. This does
not claim Angular 9 or 18 runs on the collector's Node version. The Quality workflow additionally defines checks for both collector versions
with Python suites and long-running jobs.

`python3 scripts/check-junit.py` builds the checked-out listener, installs it
into a temporary Maven repository and exercises a real Surefire application:
pass, deliberate failure, disabled/aborted tests, dynamically registered tests,
method selection, two forks, concurrent test execution, collector aggregation
and cancellation with partial results. A native run without the listener must
produce the expected Surefire XML results but fail the event assertion. The
listener is discovered from its packaged service entry, not manually invoked.
The fixture listener version is overridden from the adapter POM at run time;
Dependabot ignores that locally built artifact rather than searching Maven Central.
Only the selected Java gate requires Maven/JDK; it does not test Gradle,
multimodule reactor aggregation, Vintage, arbitrary third-party engines or JVM
crash recovery.

For browser integration, run:

```sh
python3 scripts/check-karma.py --angular 9 \
  --frontend-node /opt/node12/bin/node --chrome /opt/chrome/chrome
python3 scripts/check-karma.py --angular 18 \
  --frontend-node /opt/node22/bin/node --chrome /opt/chrome/chrome
```

These are example paths: select installed runtimes, or let the workflow prepare
them. `node` on the caller's PATH is the collector runtime. The script copies the
fixture into a temporary directory, runs `npm ci --ignore-scripts`, and invokes
the actual `ng test` builder with Chrome headless. It tests TestBed rendering,
DOM clicks, successful/failed/skipped outcomes, reporter events, native exit-code
parity, collection via module `web` with `runtime: "node-project"`, and cancellation. A real run without
the reporter proves the event gate detects missing integration. The app's
`.nvmrc` selection is checked against its distinct Node executable. npm cache,
builds and generated app state stay temporary; nothing installs into the plugin.

These older-framework compatibility fixtures contain known vulnerable framework/toolchain
dependencies, including critical findings in `npm audit`. They serve synthetic content on loopback
in disposable CI, use no secrets and are not deployable sample applications.
Do not suppress Dependabot alerts or silently upgrade the fixture's framework
major to make them disappear. Review fixes compatible with each CI job, or make
an explicit supported-matrix decision. Headless Chrome comes from the hosted
runner and is not pinned/maintained by Dependabot. When actually run, this gate executes a real Angular browser; it is not a claim of visual Claude acceptance, Rails Selenium coverage,
watch/re-run cycles, multiple browsers or native Windows support.

## Native Windows gate

[Windows modules](../.github/workflows/windows.yml) is configured for Windows
PowerShell 5.1 with collector Node 14.0.0 and PowerShell 7 with collector Node
14.0.0 and 24, all with app Node 12.22.12. It invokes [check-windows.ps1](../scripts/check-windows.ps1) and
[tests/windows/native.mjs](../tests/windows/native.mjs) on hosted Windows
runners. A hosted run is not acceptance on a real Windows 10/11 machine, and
parsing scripts or running Linux checks is not Windows acceptance.

Execute the gate separately in each native engine with installed runtimes:

```powershell
& ./scripts/check-windows.ps1 -NodePath 'C:\Tools\node14\node.exe' -ProjectNode 'C:\Tools\node12\node.exe'
```

The scenarios are intended to observe scalar wrapper args, spaces, literal argv,
selected preflight/all, private DACL, Job Object containment, parent/child/
grandchild cancellation, authenticated broker loss, compensation, removed
configuration and independent app/collector runtimes. The Windows proof sidecar
keeps its own `schema: 1`: it is a distinct proof protocol, independent of the
`schemaVersion` of configuration, state and CLI responses. Do not infer support for an Angular
app/browser from the Node 12 synthetic runtime scenario.

Start coordination uses preparation 30 s, acknowledgement 10 s, abort 10 s and
a 60 s Mod start call. On Windows each selected module adds 1 s to preparation
(capped at 50 s) and to acknowledgement (capped at 40 s). It does not limit suite duration. Normal test failure does
not abort peers; infrastructure failure can compensate the batch. Gates must
check containment and preserve locks when termination cannot be proved.

## Repository settings and post-merge verification

Repository settings and committed configuration have different activation times.
An administrator can enable alerts/graph and security updates through the
[repository REST API](https://docs.github.com/en/rest/repos/repos):

```sh
gh api --method PUT repos/OWNER/REPO/vulnerability-alerts
gh api --method PUT repos/OWNER/REPO/automated-security-fixes
```

Verify the result without reading secrets:

```sh
# Success with HTTP 204 means alerts are enabled.
gh api --silent repos/OWNER/REPO/vulnerability-alerts
# Expect enabled: true and paused: false.
gh api repos/OWNER/REPO/automated-security-fixes
# Inspect graph availability and its actual indexed coverage.
gh api repos/OWNER/REPO/dependency-graph/sbom \
  --jq '{name: .sbom.name, packages: (.sbom.packages | length)}'
```

The alert-enabling endpoint also enables the dependency graph. A successful SBOM
response proves availability, not completeness or absence of vulnerabilities.
Do not change secret scanning, push protection or main's rulesets as part of
this procedure. Security updates can become active immediately for already
indexed vulnerable dependencies, independently of the weekly configuration.

After the maintenance PR is merged into the default branch:

- Open **Insights → Dependency graph → Dependabot** and confirm each of the five
  configured entries has a successful update job. Use **Check for updates** if
  needed; inspect errors instead of assuming the weekly schedule worked.
- Check graph/SBOM coverage for Maven, the committed Python requirements and
  Ruby and Angular npm locks. Indexing is asynchronous. A successful empty/partial
  graph is not full manifest coverage. Alerts additionally depend on supported advisory data.
- Inspect the first real update PRs: minor/patch grouping, isolated majors,
  full Action SHAs with matching comments, and the correct manifests/locks.
- Confirm actual Dependabot PR checks run with read-only permissions and no
  secrets; review failures across the full affected version matrix. Do not
  create a synthetic PR and describe it as a Dependabot execution.
- Recheck alerts/security-update settings and keep human-only merge review.

The YAML is inert for version updates until it reaches the default branch.
Local lint, repository settings and this PR's CI cannot substitute for these
post-merge checks.

## Official references

- [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Updating GitHub Actions](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/auto-update-actions)
- [Supported ecosystems and SHA comments](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [Security update configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)
- [Dependabot workflow restrictions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [Bundler install](https://bundler.io/man/bundle-install.1.html)
- [Angular runtime compatibility](https://angular.dev/reference/versions)
- [Angular 18 testing and CI](https://v18.angular.dev/guide/testing/)
- [Surefire JUnit Platform](https://maven.apache.org/surefire/maven-surefire-plugin/examples/junit-platform.html)
