dev:
	npm run dev

test:
	npm test

ci:
	npm ci && npm run build && npm test

docker:
	docker build -t plot-lite:dev .

# Circuit Breaker Operations (PR-A)
.PHONY: cb:preflight cb:loadtest cb:enable cb:disable cb:health cb:version

cb:preflight:
	@echo "Running circuit breaker preflight checks..."
	@./scripts/cb_preflight.sh

cb:loadtest:
	@echo "Running circuit breaker load tests..."
	@BASE_URL=$(or $(BASE_URL),http://localhost:3000) \
	 P95=$(or $(P95),150) \
	 THRESHOLD=$(or $(THRESHOLD),10) \
	 WINDOW_MS=$(or $(WINDOW_MS),5000) \
	 ./scripts/loadtest_breaker.sh \
	   --base-url "$$BASE_URL" \
	   --p95-budget-ms "$$P95" \
	   --threshold "$$THRESHOLD" \
	   --window-ms "$$WINDOW_MS"

cb:enable:
	@echo "Current RL_CB_ENABLE: $${RL_CB_ENABLE:-<not set>}"
	@echo "Setting RL_CB_ENABLE=1..."
	@export RL_CB_ENABLE=1 && echo "RL_CB_ENABLE=1"
	@echo "Note: Export this in your shell or deployment config"

cb:disable:
	@echo "Current RL_CB_ENABLE: $${RL_CB_ENABLE:-<not set>}"
	@echo "Setting RL_CB_ENABLE=0..."
	@export RL_CB_ENABLE=0 && echo "RL_CB_ENABLE=0"
	@echo "Note: Export this in your shell or deployment config"

cb:health:
	@echo "Fetching circuit breaker health..."
	@curl -s $(or $(BASE_URL),http://localhost:3000)/v1/health | jq '{principal_extraction, circuit_breaker: {global: .circuit_breaker.global, principals: .circuit_breaker.principals}}'

cb:version:
	@echo "Fetching version flags..."
	@curl -s $(or $(BASE_URL),http://localhost:3000)/v1/health | jq '.version.flags'