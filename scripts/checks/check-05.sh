#!/usr/bin/env bash
# Module 05, Run the app: every pod is Ready and the storefront works end to end
# through Traefik on localhost:3000, against the participant's own databases.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 05: the application"
check "the cluster answers (kubectl get nodes)" "$KUBECTL" get nodes
check "every pod in namespace clickshop is Ready" pods_ready clickshop
check "the Kubernetes collectors are Ready (namespace observability)" pods_ready observability
check "the storefront answers on http://localhost:3000" http_ok http://localhost:3000/
check "the catalogue comes from Postgres (/api/categories lists categories)" \
  bash -c "$(declare -f json_get); [ \"\$(json_get http://localhost:3000/api/categories 'len(d if isinstance(d, list) else d.get(\"categories\", []))')\" -ge 1 ]"
check "search reaches ClickHouse (/api/search/text finds 'jeans')" \
  bash -c "$(declare -f json_get); [ \"\$(json_get 'http://localhost:3000/api/search/text?q=jeans' 'd[\"total\"]')\" -ge 1 ]"
check "Snowplow Micro is reachable through the storefront" http_ok http://localhost:3000/api/snowplow/micro/all
finish
