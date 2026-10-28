# Enterprise Feature Development — NEXUS-Sprint

Activated: 2026-10-23, Africa/Abidjan. Product under inspection: KachefScout in the current workspace; final feature scope awaits the product owner.

Status: **Phase 1 — Requirements & Architecture, HOLD**. The runbook is activated for intake. No architecture gate has passed, no feature is selected, and no release is authorized by this record.

## Authority and execution

The user requested the Enterprise Feature Development runbook and its core and conditional rosters. The upstream definition was located at [Agency Agents: Enterprise Feature Development](https://github.com/msitarzewski/agency-agents/blob/main/strategy/runbooks/scenario-enterprise-feature.md). Its [NEXUS quick start](https://github.com/msitarzewski/agency-agents/blob/main/strategy/QUICKSTART.md) starts Sprint mode at Phase 1. Repository inspection is intake work within that phase, not a separate approval gate.

Four concurrent agent slots are available. The primary agent coordinates the run; specialists cover related responsibilities in bounded assignments. Roles in the roster are assignments, not a claim that fifteen separate agents are running simultaneously. Implementation and QA reviewers remain separate. Human stakeholder agreement must be recorded separately from agent review.

## Responsibilities

| Roster roles | Responsibility | Current assignment |
| --- | --- | --- |
| Agents Orchestrator | Phase state, dependencies, task handoffs, retries, escalation | Primary agent; active |
| Project Shepherd; Senior Project Manager; Sprint Prioritizer | Stakeholder map, scope, acceptance criteria, task breakdown, priorities | Delivery discovery specialist; intake review complete |
| UX Architect; UX Researcher; UI Designer; Frontend Developer | Existing workflows, design conventions, user validation, frontend integration | Experience discovery specialist; static intake review complete |
| Backend Architect; Senior Developer; DevOps Automator; API Tester; Performance Benchmarker | Architecture, access boundaries, integration, migrations, pipelines, API and load verification | Engineering discovery specialist; static intake review complete |
| Evidence Collector | Verify evidence provenance and foundation; later functional, responsive and accessibility evidence | Independent intake review complete; provenance corrections incorporated |
| Reality Checker | Joint architecture review with Project Shepherd; independent final release judgment | Independent intake review complete; Phase 1 HOLD confirmed |

Conditional roles: Legal Compliance Checker is needed during intake because compliance requirements are mandatory and the product handles sensitive member data. Brand Guardian reviews feature design against the existing product. Finance Tracker activates when budget is supplied; Executive Summary Generator when stakeholder reporting is needed. Test Results Analyzer consolidates test and coverage evidence during hardening. Workflow Optimizer and Experiment Tracker activate only for a demonstrated process or experiment need. Unsupported roles appearing in the upstream rollout examples must be assigned explicitly before use; no extra agent is assumed to exist.

## Phase gates

| Phase | Required review packet | Gate owner | Current state |
| --- | --- | --- | --- |
| 1. Requirements & Architecture | Chosen feature, measurable acceptance criteria, user evidence, stakeholder decisions, applicable compliance controls, data/access design, integration/migration plan, prioritized tasks, verification plan | Project Shepherd + Reality Checker | HOLD: feature and decision inputs missing |
| 2. Foundation | Isolated test/staging data, reproducible pipeline, feature control, scaffolds, migration and restoration rehearsal | Evidence Collector | Not started; depends on Phase 1 PASS |
| 3. Build | Every task linked to its specification, implementation, API/functional checks and visual evidence where applicable; unresolved failures tracked | Agents Orchestrator coordinates independent task QA | Not started; depends on Phase 2 PASS |
| 4. Hardening | Regression, security/privacy, accessibility, brand, coverage and representative performance/load results; integration judgment | Reality Checker, with specialist evidence | Not started; depends on completed task QA |
| 5. Rollout | Staging acceptance, release-owner decision, cohort controls, monitors and rehearsed rollback; recorded canary observations at 5%, 25%, 100% | Release owner + DevOps Automator; Reality Checker judgment required | Not started; depends on Phase 4 PASS |

The upstream 6–12 week range is illustrative; no delivery date is committed. Advancing requires an explicit PASS supported by evidence for the current revision. Missing, failed, stale or inapplicable checks never imply PASS. Failed tasks return to the implementation owner with expected/actual behavior and reproduction evidence; after three failed QA cycles, escalate for reassignment, decomposition or scope decision. Gate requirements cannot be silently waived.

## Mandatory quality register

These thresholds come from the enterprise runbook. Measurement scope and methods must be settled in Phase 1; absence of instrumentation does not reduce a threshold.

| Control | Required threshold | Evidence needed | Current result |
| --- | --- | --- | --- |
| Coverage | More than 80% | Coverage report with agreed code scope and metric | Unmeasured |
| API latency | P95 below 200 ms | Representative authenticated workload, dataset, environment and latency distribution | Unmeasured |
| Accessibility | WCAG 2.1 AA | Automated findings plus manual keyboard, focus and assistive-technology checks | Unmeasured |
| Security | Zero critical vulnerabilities | Dependency and application-security findings, remediation and independent verification | FAIL: full dependency audit flags three critical-severity package entries; application security untested |
| Brand | At least 95% adherence | Agreed design checklist, denominator and reviewed feature screens | Unmeasured |
| Specification | 100% compliance | Every acceptance criterion traced to observed behavior | Cannot measure before feature specification |
| Load | Ten times current traffic | Measured current workload and representative load-test results | Baseline traffic unavailable |

Compliance is additional to these thresholds: applicable jurisdictions, obligations, retention, access, audit and deletion requirements must be identified with the accountable owner. No legal certification is inferred from source code.

## Stakeholder decisions needed

| Decision | Accountable stakeholder | State |
| --- | --- | --- |
| Confirm product, choose major feature and define business outcome | Product owner / sponsor | Requested; no response yet |
| Accept user scenarios and measurable acceptance criteria | Product owner and representative users | Pending feature |
| Identify security/privacy controls, legal jurisdiction and required compliance evidence | Security/privacy and compliance owners | Not identified |
| Agree architecture, integrations and data lifecycle | Engineering owner | Pending feature |
| Confirm release environment, date, budget, traffic baseline and rollback owner | Release/operations owner and sponsor | Not supplied |
| Accept end-to-end test scope, brand rubric and release judgment | QA/design/release owners | Pending feature |

The clarification request has already been presented in this chat. No stakeholder has been contacted externally. Communication follows the runbook's daily engineering, weekly product, fortnightly executive and monthly compliance/finance cadence when the run is active and participants/channels are identified. No recurring automation or external message has been created.

## Baseline evidence

Inspected revision: `1b9c4a3f97e46baa3de78fecc5af9fcf3d2208b3`. Evidence is scoped to this intake, the local lockfile and installed dependency tree. It does not certify a future feature or deployed environment. Source findings and review verdicts are recorded in [intake-evidence.md](intake-evidence.md).

| ID | Check | Observed result | Evidence |
| --- | --- | --- | --- |
| E01 | Existing frontend production build | PASS, exit 0; Vite warns about an initial JavaScript chunk of 550.26 kB, above its 500 kB warning threshold | [Returned build output](evidence/baseline-checks.json); build output was truncated by the tool |
| E02 | Parse backend entry, database and push modules | PASS, all three syntax checks exited 0 | [Command results](evidence/baseline-checks.json) |
| E03 | Production-dependency audit using configured mirror | UNAVAILABLE: mirror's audit endpoint returned HTTP 404 | [Command result](evidence/baseline-checks.json) |
| E04 | Full dependency audit using official npm registry | FAIL, exit 1; 9 flagged package entries: 3 critical, 3 high, 3 moderate | [Full audit JSON](evidence/dependency-audit.json), [command and provenance](evidence/dependency-audit-provenance.json) |
| E05–E07 | Delivery, engineering and experience intake | Complete, static review only; all recommend Phase 1 HOLD | [Repository references and limits](intake-evidence.md) |
| E08–E10 | Compliance, evidence and independent gate reviews | HOLD confirmed; no architecture approval or shipping certification | [Review verdicts](intake-evidence.md) |

E04 includes development dependencies. Critical entries are `concurrently`, `shell-quote` and `proxy-addr`; the first inherits severity from `shell-quote`. Independent review counted 11 unique advisory IDs across the report. Lockfile classification gives four affected production entries (one critical, three moderate) and five development entries (two critical, three high). Counts describe dependency findings, not deployed reachability or demonstrated exploits. No dependency changes were made. Fixing dependency findings and verifying application security are required before the security gate can pass. The official registry was selected only for this command; persistent npm configuration was not changed.

No automated functional/API tests, coverage measurement, browser screenshots, assistive-technology checks, benchmark, migration exercise, restoration exercise or production checks were executed. The build and syntax results do not satisfy those gates.

The Reality Checker found no material contradiction in the reviewed artifacts and confirmed that Phase 1 cannot advance to Phase 2. Final evidence-file parsing, SHA-256 provenance and recorded count checks passed. Product/dependency files retain no tracked changes; the pre-existing untracked `.codex/` directory was preserved. Only this run's documentation/evidence and ignored build output were created.

## Next transition

After the feature and mandatory constraints arrive, inspect its current behavior, record an agreed specification, finish the Phase 1 review packet, and request Project Shepherd and Reality Checker gate verdicts. Begin foundation only after the Phase 1 evidence meets its gate. Until then, perform only independent intake work.
