#!/usr/bin/env bash
# Run the native workspace qualification scripts against a fresh synthetic fixture.
# Needs CORTEX_QUALIFICATION_FIXTURE (a directory built by verify_bounded_retrieval.py),
# CORTEX_QUALIFICATION_OUTPUT (a new directory under .runtime), CORTEX_QUALIFICATION_PORT,
# and the usual test database and TerminusDB variables. Stops at the first failure.
# verify_proposal_expert_reviews is left out: it reads state from a browser session.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CORTEX_QUALIFICATION_FIXTURE:?}" "${CORTEX_QUALIFICATION_OUTPUT:?}" "${CORTEX_QUALIFICATION_PORT:?}"
read -r -a python <<< "${QUALIFICATION_PYTHON:-uv run python}"
out="$CORTEX_QUALIFICATION_OUTPUT"
mkdir -p "$out"

run() {
  echo "::group::$1"
  "${python[@]}" "scripts/$1.py" "${@:2}"
  echo "::endgroup::"
}

# Order matters where a script reads another's report: workspace_tasks writes the
# task state import_commands reads, and reference_passages the report source_locations reads.
for name in \
  workspace_tasks workspace_drafts workspace_read_models \
  agent_missions mission_evidence mission_overview \
  case_activity case_tasks shared_cases \
  companion_guides import_commands membership_roles \
  reference_drafts reference_passages reference_receipts reference_reviews review_overview \
  contribution_drafts contribution_passages source_contribution source_locations source_passage \
  proposal_source_access task_expert_reviews decision_evidence work_brief work_activity; do
  run "verify_$name"
done
# Planning reads the overview report; receipts read the planning report.
run verify_work_overview
run verify_task_planning
run verify_task_receipts
# Graph checks build their own synthetic fixtures under the output directory.
run verify_graph_read_permissions --directory "$out/graph-read-permissions"
run verify_graph_search --directory "$out/graph-search"
run verify_targeted_differences --directory "$out/targeted-differences"
run verify_long_concepts --directory "$out/long-concepts" --duration 0
run verify_paged_snapshot --directory "$out/paged-snapshot" --serve-seconds 0
run verify_graph_read_projection --directory "$out/paged-snapshot"
run verify_graph_window --synthetic-only --output "$out/graph-window.json"
echo "Workspace qualification passed"
