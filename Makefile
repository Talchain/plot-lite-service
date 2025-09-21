dev:
	npm run dev

test:
	npm test

ci:
	npm ci && npm run build && npm test

docker:
	docker build -t plot-lite:dev .