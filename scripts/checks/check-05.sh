#!/usr/bin/env bash
# Module 05, Run the app: every pod is Ready and the storefront works end to end
# through Traefik on localhost:3000, against the participant's own databases.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 05: the application"
need_cluster
check "the cluster answers (kubectl get nodes)" "$KUBECTL" get nodes || hint "the cluster is starting or stopped: make status, or make cluster again"
check "every pod in namespace clickshop is Ready" pods_ready clickshop || hint "make status shows which pod is not Ready; make logs S=<name> says why. If nothing is installed yet: make secrets app"
check "the Kubernetes collectors are Ready (namespace observability)" pods_ready observability || hint "make otel-k8s installs them (make app does it too)"
check "the storefront answers on http://localhost:3000" http_ok http://localhost:3000/ || hint "it may still be starting (make status); port 3000 must be free: make doctor"
check "the catalogue comes from Postgres (/api/categories lists categories)" \
  bash -c "$(declare -f json_get); [ \"\$(json_get http://localhost:3000/api/categories 'len(d if isinstance(d, list) else d.get(\"categories\", []))')\" -ge 1 ]" \
  || hint "the storefront cannot reach Postgres or it is empty: make doctor, make check-02"
check "search reaches ClickHouse (/api/search/text finds 'jeans')" \
  bash -c "$(declare -f json_get); [ \"\$(json_get 'http://localhost:3000/api/search/text?q=jeans' 'd[\"total\"]')\" -ge 1 ]" \
  || hint "products_search may be empty: make ch-search, then SYSTEM REFRESH VIEW retail_analytics.products_search_refresh and SYSTEM WAIT VIEW retail_analytics.products_search_refresh (module 04)"
check "Snowplow Micro is reachable through the storefront" http_ok http://localhost:3000/api/snowplow/micro/all || hint "make logs S=snowplow-micro"
finish
