=== NIGHTLY INTEGRATION REPORT ===
Started: 2025-10-06T14:35:33+01:00

[01-endpoint-sse] Running: tools/gates/01-endpoint-sse-hardening.mjs
GATES: Phase 1 — Endpoint & SSE hardening
{"level":30,"time":1759757734298,"pid":10365,"hostname":"MacBookAir.net","msg":"Server listening at http://127.0.0.1:14311"}
  Server started on http://127.0.0.1:14311
  [1/4] Testing strong ETag for GET /draft-flows
  [2/4] Testing HEAD parity
  [3/4] Testing If-None-Match → 304
{"level":30,"time":1759757734347,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1","route":"/draft-flows","statusCode":200,"durationMs":5.656625,"msg":"request completed"}
{"level":30,"time":1759757734347,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2","route":"/draft-flows","statusCode":200,"durationMs":0.427375,"msg":"request completed"}
{"level":30,"time":1759757734350,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3","route":"/draft-flows","statusCode":304,"durationMs":0.235792,"msg":"request completed"}
  [4/4] SSE stability soak (500 cycles)
{"level":30,"time":1759757734352,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4","msg":"SSE client disconnected"}
{"level":30,"time":1759757734352,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4","route":"/stream","statusCode":200,"durationMs":0.60975,"msg":"request completed"}
{"level":30,"time":1759757734356,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5","msg":"SSE client disconnected"}
{"level":30,"time":1759757734357,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5","route":"/stream","statusCode":200,"durationMs":0.439584,"msg":"request completed"}
{"level":30,"time":1759757734358,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6","msg":"SSE client disconnected"}
{"level":30,"time":1759757734358,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6","route":"/stream","statusCode":200,"durationMs":0.333125,"msg":"request completed"}
{"level":30,"time":1759757734359,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7","msg":"SSE client disconnected"}
{"level":30,"time":1759757734359,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7","route":"/stream","statusCode":200,"durationMs":0.26875,"msg":"request completed"}
{"level":30,"time":1759757734360,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8","msg":"SSE client disconnected"}
{"level":30,"time":1759757734360,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8","route":"/stream","statusCode":200,"durationMs":0.157625,"msg":"request completed"}
{"level":30,"time":1759757734361,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9","msg":"SSE client disconnected"}
{"level":30,"time":1759757734362,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9","route":"/stream","statusCode":200,"durationMs":0.328833,"msg":"request completed"}
{"level":30,"time":1759757734363,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734363,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a","route":"/stream","statusCode":200,"durationMs":0.341792,"msg":"request completed"}
{"level":30,"time":1759757734364,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734364,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b","route":"/stream","statusCode":200,"durationMs":0.282041,"msg":"request completed"}
{"level":30,"time":1759757734365,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734365,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c","route":"/stream","statusCode":200,"durationMs":0.260625,"msg":"request completed"}
{"level":30,"time":1759757734366,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734366,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d","route":"/stream","statusCode":200,"durationMs":0.221708,"msg":"request completed"}
{"level":30,"time":1759757734368,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734368,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-e","route":"/stream","statusCode":200,"durationMs":0.285958,"msg":"request completed"}
{"level":30,"time":1759757734369,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734369,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-f","route":"/stream","statusCode":200,"durationMs":0.154625,"msg":"request completed"}
{"level":30,"time":1759757734369,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734369,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-g","route":"/stream","statusCode":200,"durationMs":0.175958,"msg":"request completed"}
{"level":30,"time":1759757734370,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734370,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-h","route":"/stream","statusCode":200,"durationMs":0.135666,"msg":"request completed"}
{"level":30,"time":1759757734372,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734372,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-i","route":"/stream","statusCode":200,"durationMs":0.294458,"msg":"request completed"}
{"level":30,"time":1759757734373,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734373,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-j","route":"/stream","statusCode":200,"durationMs":0.263709,"msg":"request completed"}
{"level":30,"time":1759757734374,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734374,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-k","route":"/stream","statusCode":200,"durationMs":0.14975,"msg":"request completed"}
{"level":30,"time":1759757734375,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734375,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-l","route":"/stream","statusCode":200,"durationMs":0.155792,"msg":"request completed"}
{"level":30,"time":1759757734376,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734376,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-m","route":"/stream","statusCode":200,"durationMs":0.125792,"msg":"request completed"}
{"level":30,"time":1759757734376,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734376,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-n","route":"/stream","statusCode":200,"durationMs":0.188167,"msg":"request completed"}
{"level":30,"time":1759757734377,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734377,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-o","route":"/stream","statusCode":200,"durationMs":0.155917,"msg":"request completed"}
{"level":30,"time":1759757734378,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734378,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-p","route":"/stream","statusCode":200,"durationMs":0.134875,"msg":"request completed"}
{"level":30,"time":1759757734378,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734378,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-q","route":"/stream","statusCode":200,"durationMs":0.120541,"msg":"request completed"}
{"level":30,"time":1759757734379,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734379,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-r","route":"/stream","statusCode":200,"durationMs":0.124167,"msg":"request completed"}
{"level":30,"time":1759757734379,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734379,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-s","route":"/stream","statusCode":200,"durationMs":0.118708,"msg":"request completed"}
{"level":30,"time":1759757734380,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734380,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-t","route":"/stream","statusCode":200,"durationMs":0.121833,"msg":"request completed"}
{"level":30,"time":1759757734381,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734381,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-u","route":"/stream","statusCode":200,"durationMs":0.16075,"msg":"request completed"}
{"level":30,"time":1759757734381,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734381,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-v","route":"/stream","statusCode":200,"durationMs":0.125416,"msg":"request completed"}
{"level":30,"time":1759757734382,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734382,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-w","route":"/stream","statusCode":200,"durationMs":0.11575,"msg":"request completed"}
{"level":30,"time":1759757734382,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734382,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-x","route":"/stream","statusCode":200,"durationMs":0.12175,"msg":"request completed"}
{"level":30,"time":1759757734383,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734383,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-y","route":"/stream","statusCode":200,"durationMs":0.141917,"msg":"request completed"}
{"level":30,"time":1759757734383,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734383,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-z","route":"/stream","statusCode":200,"durationMs":0.118334,"msg":"request completed"}
{"level":30,"time":1759757734384,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-10","msg":"SSE client disconnected"}
{"level":30,"time":1759757734384,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-10","route":"/stream","statusCode":200,"durationMs":0.921708,"msg":"request completed"}
{"level":30,"time":1759757734385,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-11","msg":"SSE client disconnected"}
{"level":30,"time":1759757734385,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-11","route":"/stream","statusCode":200,"durationMs":0.205667,"msg":"request completed"}
{"level":30,"time":1759757734385,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-12","msg":"SSE client disconnected"}
{"level":30,"time":1759757734385,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-12","route":"/stream","statusCode":200,"durationMs":0.11425,"msg":"request completed"}
{"level":30,"time":1759757734386,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-13","msg":"SSE client disconnected"}
{"level":30,"time":1759757734386,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-13","route":"/stream","statusCode":200,"durationMs":0.112417,"msg":"request completed"}
{"level":30,"time":1759757734386,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-14","msg":"SSE client disconnected"}
{"level":30,"time":1759757734386,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-14","route":"/stream","statusCode":200,"durationMs":0.172625,"msg":"request completed"}
{"level":30,"time":1759757734387,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-15","msg":"SSE client disconnected"}
{"level":30,"time":1759757734387,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-15","route":"/stream","statusCode":200,"durationMs":0.144208,"msg":"request completed"}
{"level":30,"time":1759757734389,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-16","msg":"SSE client disconnected"}
{"level":30,"time":1759757734389,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-16","route":"/stream","statusCode":200,"durationMs":0.858208,"msg":"request completed"}
{"level":30,"time":1759757734391,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-17","msg":"SSE client disconnected"}
{"level":30,"time":1759757734391,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-17","route":"/stream","statusCode":200,"durationMs":0.201084,"msg":"request completed"}
{"level":30,"time":1759757734391,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-18","msg":"SSE client disconnected"}
{"level":30,"time":1759757734391,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-18","route":"/stream","statusCode":200,"durationMs":0.113917,"msg":"request completed"}
{"level":30,"time":1759757734392,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-19","msg":"SSE client disconnected"}
{"level":30,"time":1759757734392,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-19","route":"/stream","statusCode":200,"durationMs":0.786791,"msg":"request completed"}
{"level":30,"time":1759757734393,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734393,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1a","route":"/stream","statusCode":200,"durationMs":0.214125,"msg":"request completed"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1b","route":"/stream","statusCode":200,"durationMs":0.095792,"msg":"request completed"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1c","route":"/stream","statusCode":200,"durationMs":0.09575,"msg":"request completed"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734394,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1d","route":"/stream","statusCode":200,"durationMs":0.087542,"msg":"request completed"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1e","route":"/stream","statusCode":200,"durationMs":0.105125,"msg":"request completed"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1f","route":"/stream","statusCode":200,"durationMs":0.089666,"msg":"request completed"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734395,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1g","route":"/stream","statusCode":200,"durationMs":0.09425,"msg":"request completed"}
{"level":30,"time":1759757734396,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734396,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1h","route":"/stream","statusCode":200,"durationMs":0.08475,"msg":"request completed"}
{"level":30,"time":1759757734396,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734396,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1i","route":"/stream","statusCode":200,"durationMs":0.145625,"msg":"request completed"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1j","route":"/stream","statusCode":200,"durationMs":0.099459,"msg":"request completed"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1k","route":"/stream","statusCode":200,"durationMs":0.118375,"msg":"request completed"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734397,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1l","route":"/stream","statusCode":200,"durationMs":0.094125,"msg":"request completed"}
{"level":30,"time":1759757734398,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734398,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1m","route":"/stream","statusCode":200,"durationMs":0.098583,"msg":"request completed"}
{"level":30,"time":1759757734398,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734398,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1n","route":"/stream","statusCode":200,"durationMs":0.08625,"msg":"request completed"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1o","route":"/stream","statusCode":200,"durationMs":0.092125,"msg":"request completed"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1p","route":"/stream","statusCode":200,"durationMs":0.08575,"msg":"request completed"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734399,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1q","route":"/stream","statusCode":200,"durationMs":0.088125,"msg":"request completed"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1r","route":"/stream","statusCode":200,"durationMs":0.085375,"msg":"request completed"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1s","route":"/stream","statusCode":200,"durationMs":0.094417,"msg":"request completed"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734400,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1t","route":"/stream","statusCode":200,"durationMs":0.086708,"msg":"request completed"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1u","route":"/stream","statusCode":200,"durationMs":0.092584,"msg":"request completed"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1v","route":"/stream","statusCode":200,"durationMs":0.082,"msg":"request completed"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734401,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1w","route":"/stream","statusCode":200,"durationMs":0.130459,"msg":"request completed"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1x","route":"/stream","statusCode":200,"durationMs":0.082042,"msg":"request completed"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1y","route":"/stream","statusCode":200,"durationMs":0.08575,"msg":"request completed"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734402,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-1z","route":"/stream","statusCode":200,"durationMs":0.082167,"msg":"request completed"}
{"level":30,"time":1759757734403,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-20","msg":"SSE client disconnected"}
{"level":30,"time":1759757734403,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-20","route":"/stream","statusCode":200,"durationMs":0.135833,"msg":"request completed"}
{"level":30,"time":1759757734403,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-21","msg":"SSE client disconnected"}
{"level":30,"time":1759757734403,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-21","route":"/stream","statusCode":200,"durationMs":0.097792,"msg":"request completed"}
{"level":30,"time":1759757734405,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-22","msg":"SSE client disconnected"}
{"level":30,"time":1759757734405,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-22","route":"/stream","statusCode":200,"durationMs":0.309792,"msg":"request completed"}
{"level":30,"time":1759757734406,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-23","msg":"SSE client disconnected"}
{"level":30,"time":1759757734406,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-23","route":"/stream","statusCode":200,"durationMs":0.145375,"msg":"request completed"}
{"level":30,"time":1759757734407,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-24","msg":"SSE client disconnected"}
{"level":30,"time":1759757734407,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-24","route":"/stream","statusCode":200,"durationMs":0.167583,"msg":"request completed"}
{"level":30,"time":1759757734407,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-25","msg":"SSE client disconnected"}
{"level":30,"time":1759757734407,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-25","route":"/stream","statusCode":200,"durationMs":0.122834,"msg":"request completed"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-26","msg":"SSE client disconnected"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-26","route":"/stream","statusCode":200,"durationMs":0.109333,"msg":"request completed"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-27","msg":"SSE client disconnected"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-27","route":"/stream","statusCode":200,"durationMs":0.111208,"msg":"request completed"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-28","msg":"SSE client disconnected"}
{"level":30,"time":1759757734408,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-28","route":"/stream","statusCode":200,"durationMs":0.103375,"msg":"request completed"}
{"level":30,"time":1759757734409,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-29","msg":"SSE client disconnected"}
{"level":30,"time":1759757734409,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-29","route":"/stream","statusCode":200,"durationMs":0.105458,"msg":"request completed"}
{"level":30,"time":1759757734409,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734409,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2a","route":"/stream","statusCode":200,"durationMs":0.116625,"msg":"request completed"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2b","route":"/stream","statusCode":200,"durationMs":0.092334,"msg":"request completed"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2c","route":"/stream","statusCode":200,"durationMs":0.093083,"msg":"request completed"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734410,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2d","route":"/stream","statusCode":200,"durationMs":0.080042,"msg":"request completed"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2e","route":"/stream","statusCode":200,"durationMs":0.090667,"msg":"request completed"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2f","route":"/stream","statusCode":200,"durationMs":0.097209,"msg":"request completed"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734411,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2g","route":"/stream","statusCode":200,"durationMs":0.096458,"msg":"request completed"}
{"level":30,"time":1759757734412,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734412,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2h","route":"/stream","statusCode":200,"durationMs":0.07775,"msg":"request completed"}
{"level":30,"time":1759757734412,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734412,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2i","route":"/stream","statusCode":200,"durationMs":0.082292,"msg":"request completed"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2j","route":"/stream","statusCode":200,"durationMs":0.079291,"msg":"request completed"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2k","route":"/stream","statusCode":200,"durationMs":0.087875,"msg":"request completed"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2l","route":"/stream","statusCode":200,"durationMs":0.07425,"msg":"request completed"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734413,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2m","route":"/stream","statusCode":200,"durationMs":0.078625,"msg":"request completed"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2n","route":"/stream","statusCode":200,"durationMs":0.082708,"msg":"request completed"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2o","route":"/stream","statusCode":200,"durationMs":0.081333,"msg":"request completed"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734414,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2p","route":"/stream","statusCode":200,"durationMs":0.073459,"msg":"request completed"}
{"level":30,"time":1759757734415,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734415,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2q","route":"/stream","statusCode":200,"durationMs":0.07925,"msg":"request completed"}
{"level":30,"time":1759757734416,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734416,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2r","route":"/stream","statusCode":200,"durationMs":0.19725,"msg":"request completed"}
{"level":30,"time":1759757734417,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734417,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2s","route":"/stream","statusCode":200,"durationMs":0.102416,"msg":"request completed"}
{"level":30,"time":1759757734417,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734417,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2t","route":"/stream","statusCode":200,"durationMs":0.120584,"msg":"request completed"}
{"level":30,"time":1759757734418,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734418,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2u","route":"/stream","statusCode":200,"durationMs":0.1195,"msg":"request completed"}
{"level":30,"time":1759757734418,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734418,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2v","route":"/stream","statusCode":200,"durationMs":0.160791,"msg":"request completed"}
{"level":30,"time":1759757734419,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734419,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2w","route":"/stream","statusCode":200,"durationMs":0.101208,"msg":"request completed"}
{"level":30,"time":1759757734419,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734419,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2x","route":"/stream","statusCode":200,"durationMs":0.077916,"msg":"request completed"}
{"level":30,"time":1759757734420,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734420,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2y","route":"/stream","statusCode":200,"durationMs":0.079541,"msg":"request completed"}
{"level":30,"time":1759757734420,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734420,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-2z","route":"/stream","statusCode":200,"durationMs":0.071542,"msg":"request completed"}
{"level":30,"time":1759757734421,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-30","msg":"SSE client disconnected"}
{"level":30,"time":1759757734421,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-30","route":"/stream","statusCode":200,"durationMs":0.143875,"msg":"request completed"}
{"level":30,"time":1759757734421,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-31","msg":"SSE client disconnected"}
{"level":30,"time":1759757734421,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-31","route":"/stream","statusCode":200,"durationMs":0.2115,"msg":"request completed"}
{"level":30,"time":1759757734422,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-32","msg":"SSE client disconnected"}
{"level":30,"time":1759757734422,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-32","route":"/stream","statusCode":200,"durationMs":0.136375,"msg":"request completed"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-33","msg":"SSE client disconnected"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-33","route":"/stream","statusCode":200,"durationMs":0.105125,"msg":"request completed"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-34","msg":"SSE client disconnected"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-34","route":"/stream","statusCode":200,"durationMs":0.110625,"msg":"request completed"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-35","msg":"SSE client disconnected"}
{"level":30,"time":1759757734423,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-35","route":"/stream","statusCode":200,"durationMs":0.075375,"msg":"request completed"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-36","msg":"SSE client disconnected"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-36","route":"/stream","statusCode":200,"durationMs":0.0785,"msg":"request completed"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-37","msg":"SSE client disconnected"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-37","route":"/stream","statusCode":200,"durationMs":0.069458,"msg":"request completed"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-38","msg":"SSE client disconnected"}
{"level":30,"time":1759757734424,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-38","route":"/stream","statusCode":200,"durationMs":0.079584,"msg":"request completed"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-39","msg":"SSE client disconnected"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-39","route":"/stream","statusCode":200,"durationMs":0.071208,"msg":"request completed"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3a","route":"/stream","statusCode":200,"durationMs":0.073458,"msg":"request completed"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734425,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3b","route":"/stream","statusCode":200,"durationMs":0.069041,"msg":"request completed"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3c","route":"/stream","statusCode":200,"durationMs":0.073833,"msg":"request completed"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3d","route":"/stream","statusCode":200,"durationMs":0.116417,"msg":"request completed"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734426,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3e","route":"/stream","statusCode":200,"durationMs":0.080541,"msg":"request completed"}
{"level":30,"time":1759757734427,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734427,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3f","route":"/stream","statusCode":200,"durationMs":0.11175,"msg":"request completed"}
{"level":30,"time":1759757734428,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734428,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3g","route":"/stream","statusCode":200,"durationMs":0.08925,"msg":"request completed"}
{"level":30,"time":1759757734428,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734428,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3h","route":"/stream","statusCode":200,"durationMs":0.079334,"msg":"request completed"}
{"level":30,"time":1759757734428,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734429,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3i","route":"/stream","statusCode":200,"durationMs":0.079541,"msg":"request completed"}
{"level":30,"time":1759757734429,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734429,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3j","route":"/stream","statusCode":200,"durationMs":0.073,"msg":"request completed"}
{"level":30,"time":1759757734429,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734429,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3k","route":"/stream","statusCode":200,"durationMs":0.078167,"msg":"request completed"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3l","route":"/stream","statusCode":200,"durationMs":0.070416,"msg":"request completed"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3m","route":"/stream","statusCode":200,"durationMs":0.08675,"msg":"request completed"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734430,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3n","route":"/stream","statusCode":200,"durationMs":0.066709,"msg":"request completed"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3o","route":"/stream","statusCode":200,"durationMs":0.071917,"msg":"request completed"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3p","route":"/stream","statusCode":200,"durationMs":0.065792,"msg":"request completed"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3q","route":"/stream","statusCode":200,"durationMs":0.08425,"msg":"request completed"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734431,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3r","route":"/stream","statusCode":200,"durationMs":0.069625,"msg":"request completed"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3s","route":"/stream","statusCode":200,"durationMs":0.068125,"msg":"request completed"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3t","route":"/stream","statusCode":200,"durationMs":0.061625,"msg":"request completed"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734432,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3u","route":"/stream","statusCode":200,"durationMs":0.064208,"msg":"request completed"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3v","route":"/stream","statusCode":200,"durationMs":0.063584,"msg":"request completed"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3w","route":"/stream","statusCode":200,"durationMs":0.065125,"msg":"request completed"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3x","route":"/stream","statusCode":200,"durationMs":0.059209,"msg":"request completed"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734433,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3y","route":"/stream","statusCode":200,"durationMs":0.065166,"msg":"request completed"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-3z","route":"/stream","statusCode":200,"durationMs":0.061916,"msg":"request completed"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-40","msg":"SSE client disconnected"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-40","route":"/stream","statusCode":200,"durationMs":0.066792,"msg":"request completed"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-41","msg":"SSE client disconnected"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-41","route":"/stream","statusCode":200,"durationMs":0.065875,"msg":"request completed"}
{"level":30,"time":1759757734434,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-42","msg":"SSE client disconnected"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-42","route":"/stream","statusCode":200,"durationMs":0.06625,"msg":"request completed"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-43","msg":"SSE client disconnected"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-43","route":"/stream","statusCode":200,"durationMs":0.062292,"msg":"request completed"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-44","msg":"SSE client disconnected"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-44","route":"/stream","statusCode":200,"durationMs":0.070583,"msg":"request completed"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-45","msg":"SSE client disconnected"}
{"level":30,"time":1759757734435,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-45","route":"/stream","statusCode":200,"durationMs":0.100375,"msg":"request completed"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-46","msg":"SSE client disconnected"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-46","route":"/stream","statusCode":200,"durationMs":0.078708,"msg":"request completed"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-47","msg":"SSE client disconnected"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-47","route":"/stream","statusCode":200,"durationMs":0.067958,"msg":"request completed"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-48","msg":"SSE client disconnected"}
{"level":30,"time":1759757734436,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-48","route":"/stream","statusCode":200,"durationMs":0.06025,"msg":"request completed"}
{"level":30,"time":1759757734437,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-49","msg":"SSE client disconnected"}
{"level":30,"time":1759757734437,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-49","route":"/stream","statusCode":200,"durationMs":0.065084,"msg":"request completed"}
{"level":30,"time":1759757734437,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734437,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4a","route":"/stream","statusCode":200,"durationMs":0.079,"msg":"request completed"}
{"level":30,"time":1759757734438,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734438,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4b","route":"/stream","statusCode":200,"durationMs":0.573166,"msg":"request completed"}
{"level":30,"time":1759757734439,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734439,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4c","route":"/stream","statusCode":200,"durationMs":0.223375,"msg":"request completed"}
{"level":30,"time":1759757734440,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734440,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4d","route":"/stream","statusCode":200,"durationMs":0.102333,"msg":"request completed"}
{"level":30,"time":1759757734440,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734440,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4e","route":"/stream","statusCode":200,"durationMs":0.096417,"msg":"request completed"}
{"level":30,"time":1759757734441,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734441,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4f","route":"/stream","statusCode":200,"durationMs":0.081709,"msg":"request completed"}
{"level":30,"time":1759757734443,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734443,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4g","route":"/stream","statusCode":200,"durationMs":0.117375,"msg":"request completed"}
{"level":30,"time":1759757734443,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734443,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4h","route":"/stream","statusCode":200,"durationMs":0.0785,"msg":"request completed"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4i","route":"/stream","statusCode":200,"durationMs":0.068958,"msg":"request completed"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4j","route":"/stream","statusCode":200,"durationMs":0.069666,"msg":"request completed"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4k","route":"/stream","statusCode":200,"durationMs":0.069375,"msg":"request completed"}
{"level":30,"time":1759757734444,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4l","route":"/stream","statusCode":200,"durationMs":0.071375,"msg":"request completed"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4m","route":"/stream","statusCode":200,"durationMs":0.065166,"msg":"request completed"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4n","route":"/stream","statusCode":200,"durationMs":0.068667,"msg":"request completed"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734445,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4o","route":"/stream","statusCode":200,"durationMs":0.062625,"msg":"request completed"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4p","route":"/stream","statusCode":200,"durationMs":0.0675,"msg":"request completed"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4q","route":"/stream","statusCode":200,"durationMs":0.099292,"msg":"request completed"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734446,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4r","route":"/stream","statusCode":200,"durationMs":0.087375,"msg":"request completed"}
{"level":30,"time":1759757734447,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734447,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4s","route":"/stream","statusCode":200,"durationMs":0.070833,"msg":"request completed"}
{"level":30,"time":1759757734447,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734447,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4t","route":"/stream","statusCode":200,"durationMs":0.082625,"msg":"request completed"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4u","route":"/stream","statusCode":200,"durationMs":0.114708,"msg":"request completed"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4v","route":"/stream","statusCode":200,"durationMs":0.0895,"msg":"request completed"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734448,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4w","route":"/stream","statusCode":200,"durationMs":0.081292,"msg":"request completed"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4x","route":"/stream","statusCode":200,"durationMs":0.073792,"msg":"request completed"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4y","route":"/stream","statusCode":200,"durationMs":0.078666,"msg":"request completed"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734449,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-4z","route":"/stream","statusCode":200,"durationMs":0.071708,"msg":"request completed"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-50","msg":"SSE client disconnected"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-50","route":"/stream","statusCode":200,"durationMs":0.065167,"msg":"request completed"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-51","msg":"SSE client disconnected"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-51","route":"/stream","statusCode":200,"durationMs":0.065375,"msg":"request completed"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-52","msg":"SSE client disconnected"}
{"level":30,"time":1759757734450,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-52","route":"/stream","statusCode":200,"durationMs":0.080417,"msg":"request completed"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-53","msg":"SSE client disconnected"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-53","route":"/stream","statusCode":200,"durationMs":0.073417,"msg":"request completed"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-54","msg":"SSE client disconnected"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-54","route":"/stream","statusCode":200,"durationMs":0.072416,"msg":"request completed"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-55","msg":"SSE client disconnected"}
{"level":30,"time":1759757734451,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-55","route":"/stream","statusCode":200,"durationMs":0.064375,"msg":"request completed"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-56","msg":"SSE client disconnected"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-56","route":"/stream","statusCode":200,"durationMs":0.062458,"msg":"request completed"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-57","msg":"SSE client disconnected"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-57","route":"/stream","statusCode":200,"durationMs":0.072959,"msg":"request completed"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-58","msg":"SSE client disconnected"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-58","route":"/stream","statusCode":200,"durationMs":0.057375,"msg":"request completed"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-59","msg":"SSE client disconnected"}
{"level":30,"time":1759757734452,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-59","route":"/stream","statusCode":200,"durationMs":0.060667,"msg":"request completed"}
{"level":30,"time":1759757734453,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734453,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5a","route":"/stream","statusCode":200,"durationMs":0.059375,"msg":"request completed"}
{"level":30,"time":1759757734454,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734454,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5b","route":"/stream","statusCode":200,"durationMs":0.353583,"msg":"request completed"}
{"level":30,"time":1759757734454,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734454,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5c","route":"/stream","statusCode":200,"durationMs":0.197166,"msg":"request completed"}
{"level":30,"time":1759757734455,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734455,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5d","route":"/stream","statusCode":200,"durationMs":0.100375,"msg":"request completed"}
{"level":30,"time":1759757734455,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734455,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5e","route":"/stream","statusCode":200,"durationMs":0.098792,"msg":"request completed"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5f","route":"/stream","statusCode":200,"durationMs":0.079666,"msg":"request completed"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5g","route":"/stream","statusCode":200,"durationMs":0.068875,"msg":"request completed"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734456,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5h","route":"/stream","statusCode":200,"durationMs":0.077291,"msg":"request completed"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5i","route":"/stream","statusCode":200,"durationMs":0.061125,"msg":"request completed"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5j","route":"/stream","statusCode":200,"durationMs":0.098417,"msg":"request completed"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734457,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5k","route":"/stream","statusCode":200,"durationMs":0.073042,"msg":"request completed"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5l","route":"/stream","statusCode":200,"durationMs":0.06175,"msg":"request completed"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5m","route":"/stream","statusCode":200,"durationMs":0.064917,"msg":"request completed"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734458,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5n","route":"/stream","statusCode":200,"durationMs":0.082875,"msg":"request completed"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5o","route":"/stream","statusCode":200,"durationMs":0.059334,"msg":"request completed"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5p","route":"/stream","statusCode":200,"durationMs":0.059792,"msg":"request completed"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5q","route":"/stream","statusCode":200,"durationMs":0.056542,"msg":"request completed"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734459,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5r","route":"/stream","statusCode":200,"durationMs":0.060583,"msg":"request completed"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5s","route":"/stream","statusCode":200,"durationMs":0.063708,"msg":"request completed"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5t","route":"/stream","statusCode":200,"durationMs":0.075125,"msg":"request completed"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734460,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5u","route":"/stream","statusCode":200,"durationMs":0.077042,"msg":"request completed"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5v","route":"/stream","statusCode":200,"durationMs":0.08125,"msg":"request completed"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5w","route":"/stream","statusCode":200,"durationMs":0.059917,"msg":"request completed"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734461,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5x","route":"/stream","statusCode":200,"durationMs":0.069708,"msg":"request completed"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5y","route":"/stream","statusCode":200,"durationMs":0.059958,"msg":"request completed"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-5z","route":"/stream","statusCode":200,"durationMs":0.086041,"msg":"request completed"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-60","msg":"SSE client disconnected"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-60","route":"/stream","statusCode":200,"durationMs":0.058166,"msg":"request completed"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-61","msg":"SSE client disconnected"}
{"level":30,"time":1759757734462,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-61","route":"/stream","statusCode":200,"durationMs":0.082083,"msg":"request completed"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-62","msg":"SSE client disconnected"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-62","route":"/stream","statusCode":200,"durationMs":0.068417,"msg":"request completed"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-63","msg":"SSE client disconnected"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-63","route":"/stream","statusCode":200,"durationMs":0.0705,"msg":"request completed"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-64","msg":"SSE client disconnected"}
{"level":30,"time":1759757734463,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-64","route":"/stream","statusCode":200,"durationMs":0.060042,"msg":"request completed"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-65","msg":"SSE client disconnected"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-65","route":"/stream","statusCode":200,"durationMs":0.064833,"msg":"request completed"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-66","msg":"SSE client disconnected"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-66","route":"/stream","statusCode":200,"durationMs":0.0715,"msg":"request completed"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-67","msg":"SSE client disconnected"}
{"level":30,"time":1759757734464,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-67","route":"/stream","statusCode":200,"durationMs":0.067709,"msg":"request completed"}
{"level":30,"time":1759757734465,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-68","msg":"SSE client disconnected"}
{"level":30,"time":1759757734465,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-68","route":"/stream","statusCode":200,"durationMs":0.0905,"msg":"request completed"}
{"level":30,"time":1759757734466,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-69","msg":"SSE client disconnected"}
{"level":30,"time":1759757734466,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-69","route":"/stream","statusCode":200,"durationMs":0.1375,"msg":"request completed"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6a","route":"/stream","statusCode":200,"durationMs":0.071709,"msg":"request completed"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6b","route":"/stream","statusCode":200,"durationMs":0.074708,"msg":"request completed"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734467,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6c","route":"/stream","statusCode":200,"durationMs":0.058375,"msg":"request completed"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6d","route":"/stream","statusCode":200,"durationMs":0.070166,"msg":"request completed"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6e","route":"/stream","statusCode":200,"durationMs":0.081833,"msg":"request completed"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734468,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6f","route":"/stream","statusCode":200,"durationMs":0.073959,"msg":"request completed"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6g","route":"/stream","statusCode":200,"durationMs":0.065958,"msg":"request completed"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6h","route":"/stream","statusCode":200,"durationMs":0.064,"msg":"request completed"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6i","route":"/stream","statusCode":200,"durationMs":0.063,"msg":"request completed"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734469,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6j","route":"/stream","statusCode":200,"durationMs":0.065375,"msg":"request completed"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6k","route":"/stream","statusCode":200,"durationMs":0.062,"msg":"request completed"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6l","route":"/stream","statusCode":200,"durationMs":0.063875,"msg":"request completed"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734470,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6m","route":"/stream","statusCode":200,"durationMs":0.055083,"msg":"request completed"}
{"level":30,"time":1759757734471,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734471,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6n","route":"/stream","statusCode":200,"durationMs":0.077917,"msg":"request completed"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6o","route":"/stream","statusCode":200,"durationMs":0.161958,"msg":"request completed"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6p","route":"/stream","statusCode":200,"durationMs":0.099916,"msg":"request completed"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734472,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6q","route":"/stream","statusCode":200,"durationMs":0.066625,"msg":"request completed"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6r","route":"/stream","statusCode":200,"durationMs":0.069583,"msg":"request completed"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6s","route":"/stream","statusCode":200,"durationMs":0.062417,"msg":"request completed"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734473,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6t","route":"/stream","statusCode":200,"durationMs":0.0595,"msg":"request completed"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6u","route":"/stream","statusCode":200,"durationMs":0.071333,"msg":"request completed"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6v","route":"/stream","statusCode":200,"durationMs":0.074708,"msg":"request completed"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734474,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6w","route":"/stream","statusCode":200,"durationMs":0.21825,"msg":"request completed"}
{"level":30,"time":1759757734475,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734475,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6x","route":"/stream","statusCode":200,"durationMs":0.119791,"msg":"request completed"}
{"level":30,"time":1759757734475,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734475,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6y","route":"/stream","statusCode":200,"durationMs":0.076667,"msg":"request completed"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-6z","route":"/stream","statusCode":200,"durationMs":0.085333,"msg":"request completed"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-70","msg":"SSE client disconnected"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-70","route":"/stream","statusCode":200,"durationMs":0.064042,"msg":"request completed"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-71","msg":"SSE client disconnected"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-71","route":"/stream","statusCode":200,"durationMs":0.06575,"msg":"request completed"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-72","msg":"SSE client disconnected"}
{"level":30,"time":1759757734476,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-72","route":"/stream","statusCode":200,"durationMs":0.091833,"msg":"request completed"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-73","msg":"SSE client disconnected"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-73","route":"/stream","statusCode":200,"durationMs":0.07125,"msg":"request completed"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-74","msg":"SSE client disconnected"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-74","route":"/stream","statusCode":200,"durationMs":0.065833,"msg":"request completed"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-75","msg":"SSE client disconnected"}
{"level":30,"time":1759757734477,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-75","route":"/stream","statusCode":200,"durationMs":0.068917,"msg":"request completed"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-76","msg":"SSE client disconnected"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-76","route":"/stream","statusCode":200,"durationMs":0.06125,"msg":"request completed"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-77","msg":"SSE client disconnected"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-77","route":"/stream","statusCode":200,"durationMs":0.065958,"msg":"request completed"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-78","msg":"SSE client disconnected"}
{"level":30,"time":1759757734478,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-78","route":"/stream","statusCode":200,"durationMs":0.069875,"msg":"request completed"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-79","msg":"SSE client disconnected"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-79","route":"/stream","statusCode":200,"durationMs":0.074291,"msg":"request completed"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7a","route":"/stream","statusCode":200,"durationMs":0.0825,"msg":"request completed"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734479,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7b","route":"/stream","statusCode":200,"durationMs":0.079292,"msg":"request completed"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7c","route":"/stream","statusCode":200,"durationMs":0.067459,"msg":"request completed"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7d","route":"/stream","statusCode":200,"durationMs":0.068125,"msg":"request completed"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7e","route":"/stream","statusCode":200,"durationMs":0.060542,"msg":"request completed"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734480,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7f","route":"/stream","statusCode":200,"durationMs":0.069667,"msg":"request completed"}
{"level":30,"time":1759757734481,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734481,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7g","route":"/stream","statusCode":200,"durationMs":0.092708,"msg":"request completed"}
{"level":30,"time":1759757734481,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734481,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7h","route":"/stream","statusCode":200,"durationMs":0.0855,"msg":"request completed"}
{"level":30,"time":1759757734482,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734482,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7i","route":"/stream","statusCode":200,"durationMs":0.16525,"msg":"request completed"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7j","route":"/stream","statusCode":200,"durationMs":0.09375,"msg":"request completed"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7k","route":"/stream","statusCode":200,"durationMs":0.069167,"msg":"request completed"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7l","route":"/stream","statusCode":200,"durationMs":0.065583,"msg":"request completed"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734483,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7m","route":"/stream","statusCode":200,"durationMs":0.060959,"msg":"request completed"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7n","route":"/stream","statusCode":200,"durationMs":0.0645,"msg":"request completed"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7o","route":"/stream","statusCode":200,"durationMs":0.060666,"msg":"request completed"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734484,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7p","route":"/stream","statusCode":200,"durationMs":0.073833,"msg":"request completed"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7q","route":"/stream","statusCode":200,"durationMs":0.063542,"msg":"request completed"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7r","route":"/stream","statusCode":200,"durationMs":0.0605,"msg":"request completed"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7s","route":"/stream","statusCode":200,"durationMs":0.06225,"msg":"request completed"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734485,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7t","route":"/stream","statusCode":200,"durationMs":0.060959,"msg":"request completed"}
{"level":30,"time":1759757734486,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734486,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7u","route":"/stream","statusCode":200,"durationMs":0.089541,"msg":"request completed"}
{"level":30,"time":1759757734490,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734490,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7v","route":"/stream","statusCode":200,"durationMs":0.211959,"msg":"request completed"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7w","route":"/stream","statusCode":200,"durationMs":0.088583,"msg":"request completed"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7x","route":"/stream","statusCode":200,"durationMs":0.091958,"msg":"request completed"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734491,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7y","route":"/stream","statusCode":200,"durationMs":0.089709,"msg":"request completed"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-7z","route":"/stream","statusCode":200,"durationMs":0.071833,"msg":"request completed"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-80","msg":"SSE client disconnected"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-80","route":"/stream","statusCode":200,"durationMs":0.062083,"msg":"request completed"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-81","msg":"SSE client disconnected"}
{"level":30,"time":1759757734492,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-81","route":"/stream","statusCode":200,"durationMs":0.062417,"msg":"request completed"}
{"level":30,"time":1759757734493,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-82","msg":"SSE client disconnected"}
{"level":30,"time":1759757734493,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-82","route":"/stream","statusCode":200,"durationMs":0.079375,"msg":"request completed"}
{"level":30,"time":1759757734493,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-83","msg":"SSE client disconnected"}
{"level":30,"time":1759757734493,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-83","route":"/stream","statusCode":200,"durationMs":0.113833,"msg":"request completed"}
{"level":30,"time":1759757734494,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-84","msg":"SSE client disconnected"}
{"level":30,"time":1759757734494,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-84","route":"/stream","statusCode":200,"durationMs":0.093792,"msg":"request completed"}
{"level":30,"time":1759757734494,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-85","msg":"SSE client disconnected"}
{"level":30,"time":1759757734494,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-85","route":"/stream","statusCode":200,"durationMs":0.073125,"msg":"request completed"}
{"level":30,"time":1759757734494,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-86","msg":"SSE client disconnected"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-86","route":"/stream","statusCode":200,"durationMs":0.085209,"msg":"request completed"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-87","msg":"SSE client disconnected"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-87","route":"/stream","statusCode":200,"durationMs":0.073833,"msg":"request completed"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-88","msg":"SSE client disconnected"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-88","route":"/stream","statusCode":200,"durationMs":0.080875,"msg":"request completed"}
{"level":30,"time":1759757734495,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-89","msg":"SSE client disconnected"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-89","route":"/stream","statusCode":200,"durationMs":0.066917,"msg":"request completed"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8a","route":"/stream","statusCode":200,"durationMs":0.077292,"msg":"request completed"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8b","route":"/stream","statusCode":200,"durationMs":0.0735,"msg":"request completed"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734496,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8c","route":"/stream","statusCode":200,"durationMs":0.064125,"msg":"request completed"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8d","route":"/stream","statusCode":200,"durationMs":0.066458,"msg":"request completed"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8e","route":"/stream","statusCode":200,"durationMs":0.059417,"msg":"request completed"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734497,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8f","route":"/stream","statusCode":200,"durationMs":0.084583,"msg":"request completed"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8g","route":"/stream","statusCode":200,"durationMs":0.074458,"msg":"request completed"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8h","route":"/stream","statusCode":200,"durationMs":0.068959,"msg":"request completed"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734498,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8i","route":"/stream","statusCode":200,"durationMs":0.063708,"msg":"request completed"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8j","route":"/stream","statusCode":200,"durationMs":0.067167,"msg":"request completed"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8k","route":"/stream","statusCode":200,"durationMs":0.064583,"msg":"request completed"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8l","route":"/stream","statusCode":200,"durationMs":0.062916,"msg":"request completed"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734499,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8m","route":"/stream","statusCode":200,"durationMs":0.060583,"msg":"request completed"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8n","route":"/stream","statusCode":200,"durationMs":0.1065,"msg":"request completed"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8o","route":"/stream","statusCode":200,"durationMs":0.058041,"msg":"request completed"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734500,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8p","route":"/stream","statusCode":200,"durationMs":0.058875,"msg":"request completed"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8q","route":"/stream","statusCode":200,"durationMs":0.068458,"msg":"request completed"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8r","route":"/stream","statusCode":200,"durationMs":0.069083,"msg":"request completed"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734501,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8s","route":"/stream","statusCode":200,"durationMs":0.061916,"msg":"request completed"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8t","route":"/stream","statusCode":200,"durationMs":0.064584,"msg":"request completed"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8u","route":"/stream","statusCode":200,"durationMs":0.087,"msg":"request completed"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734502,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8v","route":"/stream","statusCode":200,"durationMs":0.069917,"msg":"request completed"}
{"level":30,"time":1759757734503,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734503,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8w","route":"/stream","statusCode":200,"durationMs":0.06425,"msg":"request completed"}
{"level":30,"time":1759757734503,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734503,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8x","route":"/stream","statusCode":200,"durationMs":0.078416,"msg":"request completed"}
{"level":30,"time":1759757734504,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734504,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8y","route":"/stream","statusCode":200,"durationMs":0.31975,"msg":"request completed"}
{"level":30,"time":1759757734505,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734505,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-8z","route":"/stream","statusCode":200,"durationMs":0.210875,"msg":"request completed"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-90","msg":"SSE client disconnected"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-90","route":"/stream","statusCode":200,"durationMs":0.110292,"msg":"request completed"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-91","msg":"SSE client disconnected"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-91","route":"/stream","statusCode":200,"durationMs":0.087916,"msg":"request completed"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-92","msg":"SSE client disconnected"}
{"level":30,"time":1759757734506,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-92","route":"/stream","statusCode":200,"durationMs":0.071791,"msg":"request completed"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-93","msg":"SSE client disconnected"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-93","route":"/stream","statusCode":200,"durationMs":0.088167,"msg":"request completed"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-94","msg":"SSE client disconnected"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-94","route":"/stream","statusCode":200,"durationMs":0.065541,"msg":"request completed"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-95","msg":"SSE client disconnected"}
{"level":30,"time":1759757734507,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-95","route":"/stream","statusCode":200,"durationMs":0.120542,"msg":"request completed"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-96","msg":"SSE client disconnected"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-96","route":"/stream","statusCode":200,"durationMs":0.074209,"msg":"request completed"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-97","msg":"SSE client disconnected"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-97","route":"/stream","statusCode":200,"durationMs":0.070584,"msg":"request completed"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-98","msg":"SSE client disconnected"}
{"level":30,"time":1759757734508,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-98","route":"/stream","statusCode":200,"durationMs":0.078458,"msg":"request completed"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-99","msg":"SSE client disconnected"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-99","route":"/stream","statusCode":200,"durationMs":0.072375,"msg":"request completed"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9a","msg":"SSE client disconnected"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9a","route":"/stream","statusCode":200,"durationMs":0.072834,"msg":"request completed"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9b","msg":"SSE client disconnected"}
{"level":30,"time":1759757734509,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9b","route":"/stream","statusCode":200,"durationMs":0.063375,"msg":"request completed"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9c","msg":"SSE client disconnected"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9c","route":"/stream","statusCode":200,"durationMs":0.057833,"msg":"request completed"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9d","msg":"SSE client disconnected"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9d","route":"/stream","statusCode":200,"durationMs":0.06225,"msg":"request completed"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9e","msg":"SSE client disconnected"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9e","route":"/stream","statusCode":200,"durationMs":0.066208,"msg":"request completed"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9f","msg":"SSE client disconnected"}
{"level":30,"time":1759757734510,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9f","route":"/stream","statusCode":200,"durationMs":0.059833,"msg":"request completed"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9g","msg":"SSE client disconnected"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9g","route":"/stream","statusCode":200,"durationMs":0.058625,"msg":"request completed"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9h","msg":"SSE client disconnected"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9h","route":"/stream","statusCode":200,"durationMs":0.079,"msg":"request completed"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9i","msg":"SSE client disconnected"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9i","route":"/stream","statusCode":200,"durationMs":0.071458,"msg":"request completed"}
{"level":30,"time":1759757734511,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9j","msg":"SSE client disconnected"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9j","route":"/stream","statusCode":200,"durationMs":0.063959,"msg":"request completed"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9k","msg":"SSE client disconnected"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9k","route":"/stream","statusCode":200,"durationMs":0.061125,"msg":"request completed"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9l","msg":"SSE client disconnected"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9l","route":"/stream","statusCode":200,"durationMs":0.061625,"msg":"request completed"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9m","msg":"SSE client disconnected"}
{"level":30,"time":1759757734512,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9m","route":"/stream","statusCode":200,"durationMs":0.056875,"msg":"request completed"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9n","msg":"SSE client disconnected"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9n","route":"/stream","statusCode":200,"durationMs":0.059375,"msg":"request completed"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9o","msg":"SSE client disconnected"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9o","route":"/stream","statusCode":200,"durationMs":0.055291,"msg":"request completed"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9p","msg":"SSE client disconnected"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9p","route":"/stream","statusCode":200,"durationMs":0.058208,"msg":"request completed"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9q","msg":"SSE client disconnected"}
{"level":30,"time":1759757734513,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9q","route":"/stream","statusCode":200,"durationMs":0.057791,"msg":"request completed"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9r","msg":"SSE client disconnected"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9r","route":"/stream","statusCode":200,"durationMs":0.06825,"msg":"request completed"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9s","msg":"SSE client disconnected"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9s","route":"/stream","statusCode":200,"durationMs":0.088708,"msg":"request completed"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9t","msg":"SSE client disconnected"}
{"level":30,"time":1759757734514,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9t","route":"/stream","statusCode":200,"durationMs":0.077291,"msg":"request completed"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9u","msg":"SSE client disconnected"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9u","route":"/stream","statusCode":200,"durationMs":0.068583,"msg":"request completed"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9v","msg":"SSE client disconnected"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9v","route":"/stream","statusCode":200,"durationMs":0.063875,"msg":"request completed"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9w","msg":"SSE client disconnected"}
{"level":30,"time":1759757734515,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9w","route":"/stream","statusCode":200,"durationMs":0.083417,"msg":"request completed"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9x","msg":"SSE client disconnected"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9x","route":"/stream","statusCode":200,"durationMs":0.077333,"msg":"request completed"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9y","msg":"SSE client disconnected"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9y","route":"/stream","statusCode":200,"durationMs":0.063416,"msg":"request completed"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9z","msg":"SSE client disconnected"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-9z","route":"/stream","statusCode":200,"durationMs":0.067583,"msg":"request completed"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a0","msg":"SSE client disconnected"}
{"level":30,"time":1759757734516,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a0","route":"/stream","statusCode":200,"durationMs":0.063708,"msg":"request completed"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a1","msg":"SSE client disconnected"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a1","route":"/stream","statusCode":200,"durationMs":0.061708,"msg":"request completed"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a2","msg":"SSE client disconnected"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a2","route":"/stream","statusCode":200,"durationMs":0.060833,"msg":"request completed"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a3","msg":"SSE client disconnected"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a3","route":"/stream","statusCode":200,"durationMs":0.058166,"msg":"request completed"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a4","msg":"SSE client disconnected"}
{"level":30,"time":1759757734517,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a4","route":"/stream","statusCode":200,"durationMs":0.053834,"msg":"request completed"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a5","msg":"SSE client disconnected"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a5","route":"/stream","statusCode":200,"durationMs":0.074291,"msg":"request completed"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a6","msg":"SSE client disconnected"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a6","route":"/stream","statusCode":200,"durationMs":0.066208,"msg":"request completed"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a7","msg":"SSE client disconnected"}
{"level":30,"time":1759757734518,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a7","route":"/stream","statusCode":200,"durationMs":0.064041,"msg":"request completed"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a8","msg":"SSE client disconnected"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a8","route":"/stream","statusCode":200,"durationMs":0.051125,"msg":"request completed"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a9","msg":"SSE client disconnected"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-a9","route":"/stream","statusCode":200,"durationMs":0.055375,"msg":"request completed"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aa","msg":"SSE client disconnected"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aa","route":"/stream","statusCode":200,"durationMs":0.05075,"msg":"request completed"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ab","msg":"SSE client disconnected"}
{"level":30,"time":1759757734519,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ab","route":"/stream","statusCode":200,"durationMs":0.057916,"msg":"request completed"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ac","msg":"SSE client disconnected"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ac","route":"/stream","statusCode":200,"durationMs":0.052958,"msg":"request completed"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ad","msg":"SSE client disconnected"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ad","route":"/stream","statusCode":200,"durationMs":0.068,"msg":"request completed"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ae","msg":"SSE client disconnected"}
{"level":30,"time":1759757734520,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ae","route":"/stream","statusCode":200,"durationMs":0.077541,"msg":"request completed"}
{"level":30,"time":1759757734521,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-af","msg":"SSE client disconnected"}
{"level":30,"time":1759757734521,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-af","route":"/stream","statusCode":200,"durationMs":0.161209,"msg":"request completed"}
{"level":30,"time":1759757734521,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ag","msg":"SSE client disconnected"}
{"level":30,"time":1759757734521,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ag","route":"/stream","statusCode":200,"durationMs":0.143958,"msg":"request completed"}
{"level":30,"time":1759757734522,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ah","msg":"SSE client disconnected"}
{"level":30,"time":1759757734522,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ah","route":"/stream","statusCode":200,"durationMs":0.108,"msg":"request completed"}
{"level":30,"time":1759757734522,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ai","msg":"SSE client disconnected"}
{"level":30,"time":1759757734522,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ai","route":"/stream","statusCode":200,"durationMs":0.079541,"msg":"request completed"}
{"level":30,"time":1759757734523,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aj","msg":"SSE client disconnected"}
{"level":30,"time":1759757734523,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aj","route":"/stream","statusCode":200,"durationMs":0.127834,"msg":"request completed"}
{"level":30,"time":1759757734523,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ak","msg":"SSE client disconnected"}
{"level":30,"time":1759757734523,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ak","route":"/stream","statusCode":200,"durationMs":0.238458,"msg":"request completed"}
{"level":30,"time":1759757734524,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-al","msg":"SSE client disconnected"}
{"level":30,"time":1759757734524,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-al","route":"/stream","statusCode":200,"durationMs":0.095208,"msg":"request completed"}
{"level":30,"time":1759757734524,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-am","msg":"SSE client disconnected"}
{"level":30,"time":1759757734524,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-am","route":"/stream","statusCode":200,"durationMs":0.279166,"msg":"request completed"}
{"level":30,"time":1759757734525,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-an","msg":"SSE client disconnected"}
{"level":30,"time":1759757734525,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-an","route":"/stream","statusCode":200,"durationMs":0.10475,"msg":"request completed"}
{"level":30,"time":1759757734525,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ao","msg":"SSE client disconnected"}
{"level":30,"time":1759757734525,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ao","route":"/stream","statusCode":200,"durationMs":0.071958,"msg":"request completed"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ap","msg":"SSE client disconnected"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ap","route":"/stream","statusCode":200,"durationMs":0.100583,"msg":"request completed"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aq","msg":"SSE client disconnected"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aq","route":"/stream","statusCode":200,"durationMs":0.069875,"msg":"request completed"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ar","msg":"SSE client disconnected"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ar","route":"/stream","statusCode":200,"durationMs":0.073458,"msg":"request completed"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-as","msg":"SSE client disconnected"}
{"level":30,"time":1759757734526,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-as","route":"/stream","statusCode":200,"durationMs":0.06325,"msg":"request completed"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-at","msg":"SSE client disconnected"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-at","route":"/stream","statusCode":200,"durationMs":0.06675,"msg":"request completed"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-au","msg":"SSE client disconnected"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-au","route":"/stream","statusCode":200,"durationMs":0.080875,"msg":"request completed"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-av","msg":"SSE client disconnected"}
{"level":30,"time":1759757734527,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-av","route":"/stream","statusCode":200,"durationMs":0.0685,"msg":"request completed"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aw","msg":"SSE client disconnected"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-aw","route":"/stream","statusCode":200,"durationMs":0.086375,"msg":"request completed"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ax","msg":"SSE client disconnected"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ax","route":"/stream","statusCode":200,"durationMs":0.074541,"msg":"request completed"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ay","msg":"SSE client disconnected"}
{"level":30,"time":1759757734528,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ay","route":"/stream","statusCode":200,"durationMs":0.066583,"msg":"request completed"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-az","msg":"SSE client disconnected"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-az","route":"/stream","statusCode":200,"durationMs":0.069,"msg":"request completed"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b0","msg":"SSE client disconnected"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b0","route":"/stream","statusCode":200,"durationMs":0.090583,"msg":"request completed"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b1","msg":"SSE client disconnected"}
{"level":30,"time":1759757734529,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b1","route":"/stream","statusCode":200,"durationMs":0.084667,"msg":"request completed"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b2","msg":"SSE client disconnected"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b2","route":"/stream","statusCode":200,"durationMs":0.064792,"msg":"request completed"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b3","msg":"SSE client disconnected"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b3","route":"/stream","statusCode":200,"durationMs":0.06175,"msg":"request completed"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b4","msg":"SSE client disconnected"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b4","route":"/stream","statusCode":200,"durationMs":0.059083,"msg":"request completed"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b5","msg":"SSE client disconnected"}
{"level":30,"time":1759757734530,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b5","route":"/stream","statusCode":200,"durationMs":0.100708,"msg":"request completed"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b6","msg":"SSE client disconnected"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b6","route":"/stream","statusCode":200,"durationMs":0.075416,"msg":"request completed"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b7","msg":"SSE client disconnected"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b7","route":"/stream","statusCode":200,"durationMs":0.067042,"msg":"request completed"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b8","msg":"SSE client disconnected"}
{"level":30,"time":1759757734531,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b8","route":"/stream","statusCode":200,"durationMs":0.065083,"msg":"request completed"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b9","msg":"SSE client disconnected"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-b9","route":"/stream","statusCode":200,"durationMs":0.06975,"msg":"request completed"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ba","msg":"SSE client disconnected"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ba","route":"/stream","statusCode":200,"durationMs":0.07025,"msg":"request completed"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bb","msg":"SSE client disconnected"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bb","route":"/stream","statusCode":200,"durationMs":0.060083,"msg":"request completed"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bc","msg":"SSE client disconnected"}
{"level":30,"time":1759757734532,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bc","route":"/stream","statusCode":200,"durationMs":0.0995,"msg":"request completed"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bd","msg":"SSE client disconnected"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bd","route":"/stream","statusCode":200,"durationMs":0.056625,"msg":"request completed"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-be","msg":"SSE client disconnected"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-be","route":"/stream","statusCode":200,"durationMs":0.054792,"msg":"request completed"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bf","msg":"SSE client disconnected"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bf","route":"/stream","statusCode":200,"durationMs":0.055875,"msg":"request completed"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bg","msg":"SSE client disconnected"}
{"level":30,"time":1759757734533,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bg","route":"/stream","statusCode":200,"durationMs":0.057958,"msg":"request completed"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bh","msg":"SSE client disconnected"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bh","route":"/stream","statusCode":200,"durationMs":0.059208,"msg":"request completed"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bi","msg":"SSE client disconnected"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bi","route":"/stream","statusCode":200,"durationMs":0.078833,"msg":"request completed"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bj","msg":"SSE client disconnected"}
{"level":30,"time":1759757734534,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bj","route":"/stream","statusCode":200,"durationMs":0.072042,"msg":"request completed"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bk","msg":"SSE client disconnected"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bk","route":"/stream","statusCode":200,"durationMs":0.075625,"msg":"request completed"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bl","msg":"SSE client disconnected"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bl","route":"/stream","statusCode":200,"durationMs":0.070125,"msg":"request completed"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bm","msg":"SSE client disconnected"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bm","route":"/stream","statusCode":200,"durationMs":0.060375,"msg":"request completed"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bn","msg":"SSE client disconnected"}
{"level":30,"time":1759757734535,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bn","route":"/stream","statusCode":200,"durationMs":0.060042,"msg":"request completed"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bo","msg":"SSE client disconnected"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bo","route":"/stream","statusCode":200,"durationMs":0.061958,"msg":"request completed"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bp","msg":"SSE client disconnected"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bp","route":"/stream","statusCode":200,"durationMs":0.073833,"msg":"request completed"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bq","msg":"SSE client disconnected"}
{"level":30,"time":1759757734536,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bq","route":"/stream","statusCode":200,"durationMs":0.062209,"msg":"request completed"}
{"level":30,"time":1759757734537,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-br","msg":"SSE client disconnected"}
{"level":30,"time":1759757734537,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-br","route":"/stream","statusCode":200,"durationMs":0.061542,"msg":"request completed"}
{"level":30,"time":1759757734537,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bs","msg":"SSE client disconnected"}
{"level":30,"time":1759757734537,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bs","route":"/stream","statusCode":200,"durationMs":0.072708,"msg":"request completed"}
{"level":30,"time":1759757734538,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bt","msg":"SSE client disconnected"}
{"level":30,"time":1759757734538,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bt","route":"/stream","statusCode":200,"durationMs":0.42875,"msg":"request completed"}
{"level":30,"time":1759757734539,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bu","msg":"SSE client disconnected"}
{"level":30,"time":1759757734539,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bu","route":"/stream","statusCode":200,"durationMs":0.173625,"msg":"request completed"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bv","msg":"SSE client disconnected"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bv","route":"/stream","statusCode":200,"durationMs":0.1425,"msg":"request completed"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bw","msg":"SSE client disconnected"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bw","route":"/stream","statusCode":200,"durationMs":0.075875,"msg":"request completed"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bx","msg":"SSE client disconnected"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bx","route":"/stream","statusCode":200,"durationMs":0.085417,"msg":"request completed"}
{"level":30,"time":1759757734540,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-by","msg":"SSE client disconnected"}
{"level":30,"time":1759757734541,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-by","route":"/stream","statusCode":200,"durationMs":0.063083,"msg":"request completed"}
{"level":30,"time":1759757734541,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bz","msg":"SSE client disconnected"}
{"level":30,"time":1759757734541,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-bz","route":"/stream","statusCode":200,"durationMs":0.065458,"msg":"request completed"}
{"level":30,"time":1759757734541,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c0","msg":"SSE client disconnected"}
{"level":30,"time":1759757734541,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c0","route":"/stream","statusCode":200,"durationMs":0.087042,"msg":"request completed"}
{"level":30,"time":1759757734543,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c1","msg":"SSE client disconnected"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c1","route":"/stream","statusCode":200,"durationMs":0.171833,"msg":"request completed"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c2","msg":"SSE client disconnected"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c2","route":"/stream","statusCode":200,"durationMs":0.086375,"msg":"request completed"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c3","msg":"SSE client disconnected"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c3","route":"/stream","statusCode":200,"durationMs":0.065167,"msg":"request completed"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c4","msg":"SSE client disconnected"}
{"level":30,"time":1759757734544,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c4","route":"/stream","statusCode":200,"durationMs":0.058083,"msg":"request completed"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c5","msg":"SSE client disconnected"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c5","route":"/stream","statusCode":200,"durationMs":0.06125,"msg":"request completed"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c6","msg":"SSE client disconnected"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c6","route":"/stream","statusCode":200,"durationMs":0.075416,"msg":"request completed"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c7","msg":"SSE client disconnected"}
{"level":30,"time":1759757734545,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c7","route":"/stream","statusCode":200,"durationMs":0.067125,"msg":"request completed"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c8","msg":"SSE client disconnected"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c8","route":"/stream","statusCode":200,"durationMs":0.060792,"msg":"request completed"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c9","msg":"SSE client disconnected"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-c9","route":"/stream","statusCode":200,"durationMs":0.061208,"msg":"request completed"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ca","msg":"SSE client disconnected"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ca","route":"/stream","statusCode":200,"durationMs":0.057,"msg":"request completed"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cb","msg":"SSE client disconnected"}
{"level":30,"time":1759757734546,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cb","route":"/stream","statusCode":200,"durationMs":0.0595,"msg":"request completed"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cc","msg":"SSE client disconnected"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cc","route":"/stream","statusCode":200,"durationMs":0.055625,"msg":"request completed"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cd","msg":"SSE client disconnected"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cd","route":"/stream","statusCode":200,"durationMs":0.059458,"msg":"request completed"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ce","msg":"SSE client disconnected"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ce","route":"/stream","statusCode":200,"durationMs":0.051167,"msg":"request completed"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cf","msg":"SSE client disconnected"}
{"level":30,"time":1759757734547,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cf","route":"/stream","statusCode":200,"durationMs":0.083959,"msg":"request completed"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cg","msg":"SSE client disconnected"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cg","route":"/stream","statusCode":200,"durationMs":0.05125,"msg":"request completed"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ch","msg":"SSE client disconnected"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ch","route":"/stream","statusCode":200,"durationMs":0.055833,"msg":"request completed"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ci","msg":"SSE client disconnected"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ci","route":"/stream","statusCode":200,"durationMs":0.076875,"msg":"request completed"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cj","msg":"SSE client disconnected"}
{"level":30,"time":1759757734548,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cj","route":"/stream","statusCode":200,"durationMs":0.0665,"msg":"request completed"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ck","msg":"SSE client disconnected"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ck","route":"/stream","statusCode":200,"durationMs":0.059666,"msg":"request completed"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cl","msg":"SSE client disconnected"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cl","route":"/stream","statusCode":200,"durationMs":0.058792,"msg":"request completed"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cm","msg":"SSE client disconnected"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cm","route":"/stream","statusCode":200,"durationMs":0.056667,"msg":"request completed"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cn","msg":"SSE client disconnected"}
{"level":30,"time":1759757734549,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cn","route":"/stream","statusCode":200,"durationMs":0.079583,"msg":"request completed"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-co","msg":"SSE client disconnected"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-co","route":"/stream","statusCode":200,"durationMs":0.069041,"msg":"request completed"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cp","msg":"SSE client disconnected"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cp","route":"/stream","statusCode":200,"durationMs":0.060833,"msg":"request completed"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cq","msg":"SSE client disconnected"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cq","route":"/stream","statusCode":200,"durationMs":0.055333,"msg":"request completed"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cr","msg":"SSE client disconnected"}
{"level":30,"time":1759757734550,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cr","route":"/stream","statusCode":200,"durationMs":0.053917,"msg":"request completed"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cs","msg":"SSE client disconnected"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cs","route":"/stream","statusCode":200,"durationMs":0.053791,"msg":"request completed"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ct","msg":"SSE client disconnected"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ct","route":"/stream","statusCode":200,"durationMs":0.055917,"msg":"request completed"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cu","msg":"SSE client disconnected"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cu","route":"/stream","statusCode":200,"durationMs":0.052917,"msg":"request completed"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cv","msg":"SSE client disconnected"}
{"level":30,"time":1759757734551,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cv","route":"/stream","statusCode":200,"durationMs":0.062459,"msg":"request completed"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cw","msg":"SSE client disconnected"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cw","route":"/stream","statusCode":200,"durationMs":0.050292,"msg":"request completed"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cx","msg":"SSE client disconnected"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cx","route":"/stream","statusCode":200,"durationMs":0.065834,"msg":"request completed"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cy","msg":"SSE client disconnected"}
{"level":30,"time":1759757734552,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cy","route":"/stream","statusCode":200,"durationMs":0.079208,"msg":"request completed"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cz","msg":"SSE client disconnected"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-cz","route":"/stream","statusCode":200,"durationMs":0.063708,"msg":"request completed"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d0","msg":"SSE client disconnected"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d0","route":"/stream","statusCode":200,"durationMs":0.058958,"msg":"request completed"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d1","msg":"SSE client disconnected"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d1","route":"/stream","statusCode":200,"durationMs":0.056333,"msg":"request completed"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d2","msg":"SSE client disconnected"}
{"level":30,"time":1759757734553,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d2","route":"/stream","statusCode":200,"durationMs":0.051792,"msg":"request completed"}
{"level":30,"time":1759757734554,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d3","msg":"SSE client disconnected"}
{"level":30,"time":1759757734554,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d3","route":"/stream","statusCode":200,"durationMs":0.057791,"msg":"request completed"}
{"level":30,"time":1759757734555,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d4","msg":"SSE client disconnected"}
{"level":30,"time":1759757734555,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d4","route":"/stream","statusCode":200,"durationMs":0.25125,"msg":"request completed"}
{"level":30,"time":1759757734556,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d5","msg":"SSE client disconnected"}
{"level":30,"time":1759757734556,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d5","route":"/stream","statusCode":200,"durationMs":0.316458,"msg":"request completed"}
{"level":30,"time":1759757734557,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d6","msg":"SSE client disconnected"}
{"level":30,"time":1759757734557,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d6","route":"/stream","statusCode":200,"durationMs":0.122208,"msg":"request completed"}
{"level":30,"time":1759757734557,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d7","msg":"SSE client disconnected"}
{"level":30,"time":1759757734557,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d7","route":"/stream","statusCode":200,"durationMs":0.109375,"msg":"request completed"}
{"level":30,"time":1759757734557,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d8","msg":"SSE client disconnected"}
{"level":30,"time":1759757734558,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d8","route":"/stream","statusCode":200,"durationMs":0.066084,"msg":"request completed"}
{"level":30,"time":1759757734558,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d9","msg":"SSE client disconnected"}
{"level":30,"time":1759757734558,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-d9","route":"/stream","statusCode":200,"durationMs":0.10875,"msg":"request completed"}
{"level":30,"time":1759757734558,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-da","msg":"SSE client disconnected"}
{"level":30,"time":1759757734558,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-da","route":"/stream","statusCode":200,"durationMs":0.068417,"msg":"request completed"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-db","msg":"SSE client disconnected"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-db","route":"/stream","statusCode":200,"durationMs":0.064791,"msg":"request completed"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dc","msg":"SSE client disconnected"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dc","route":"/stream","statusCode":200,"durationMs":0.059917,"msg":"request completed"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dd","msg":"SSE client disconnected"}
{"level":30,"time":1759757734559,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dd","route":"/stream","statusCode":200,"durationMs":0.061125,"msg":"request completed"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-de","msg":"SSE client disconnected"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-de","route":"/stream","statusCode":200,"durationMs":0.054833,"msg":"request completed"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-df","msg":"SSE client disconnected"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-df","route":"/stream","statusCode":200,"durationMs":0.055,"msg":"request completed"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dg","msg":"SSE client disconnected"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dg","route":"/stream","statusCode":200,"durationMs":0.083875,"msg":"request completed"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dh","msg":"SSE client disconnected"}
{"level":30,"time":1759757734560,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dh","route":"/stream","statusCode":200,"durationMs":0.068875,"msg":"request completed"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-di","msg":"SSE client disconnected"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-di","route":"/stream","statusCode":200,"durationMs":0.0845,"msg":"request completed"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dj","msg":"SSE client disconnected"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dj","route":"/stream","statusCode":200,"durationMs":0.071667,"msg":"request completed"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dk","msg":"SSE client disconnected"}
{"level":30,"time":1759757734561,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dk","route":"/stream","statusCode":200,"durationMs":0.072833,"msg":"request completed"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dl","msg":"SSE client disconnected"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dl","route":"/stream","statusCode":200,"durationMs":0.060834,"msg":"request completed"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dm","msg":"SSE client disconnected"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dm","route":"/stream","statusCode":200,"durationMs":0.059542,"msg":"request completed"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dn","msg":"SSE client disconnected"}
{"level":30,"time":1759757734562,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dn","route":"/stream","statusCode":200,"durationMs":0.061833,"msg":"request completed"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-do","msg":"SSE client disconnected"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-do","route":"/stream","statusCode":200,"durationMs":0.06375,"msg":"request completed"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dp","msg":"SSE client disconnected"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dp","route":"/stream","statusCode":200,"durationMs":0.059667,"msg":"request completed"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dq","msg":"SSE client disconnected"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dq","route":"/stream","statusCode":200,"durationMs":0.060875,"msg":"request completed"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dr","msg":"SSE client disconnected"}
{"level":30,"time":1759757734563,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dr","route":"/stream","statusCode":200,"durationMs":0.055458,"msg":"request completed"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ds","msg":"SSE client disconnected"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-ds","route":"/stream","statusCode":200,"durationMs":0.060583,"msg":"request completed"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dt","msg":"SSE client disconnected"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dt","route":"/stream","statusCode":200,"durationMs":0.050667,"msg":"request completed"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-du","msg":"SSE client disconnected"}
{"level":30,"time":1759757734564,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-du","route":"/stream","statusCode":200,"durationMs":0.078917,"msg":"request completed"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dv","msg":"SSE client disconnected"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dv","route":"/stream","statusCode":200,"durationMs":0.063958,"msg":"request completed"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dw","msg":"SSE client disconnected"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dw","route":"/stream","statusCode":200,"durationMs":0.0595,"msg":"request completed"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dx","msg":"SSE client disconnected"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dx","route":"/stream","statusCode":200,"durationMs":0.071166,"msg":"request completed"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dy","msg":"SSE client disconnected"}
{"level":30,"time":1759757734565,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dy","route":"/stream","statusCode":200,"durationMs":0.060459,"msg":"request completed"}
{"level":30,"time":1759757734566,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dz","msg":"SSE client disconnected"}
{"level":30,"time":1759757734566,"pid":10365,"hostname":"MacBookAir.net","reqId":"req-dz","route":"/stream","statusCode":200,"durationMs":0.055333,"msg":"request completed"}
GATES: PASS — draft-flows deterministic (etag/head/304 OK), SSE stable (N=500, inflight=0)
[01-endpoint-sse] PASS (1s)
[02-contracts] Running: tools/gates/02-contracts-alignment.mjs
GATES: Phase 2 — Contracts alignment
  Reading canonical schema: /Users/paulslee/olumi/olumi-contracts/schemas/report.v1.schema.json
  [1/3] Extending schema with new IR fields
  Extended schema written: /Users/paulslee/Documents/GitHub/plot-lite-service/schemas/report.v1.extended.json
  [2/3] Validating extended schema
  [3/3] Generating OpenAPI fragment
  OpenAPI fragment written: /Users/paulslee/Documents/GitHub/plot-lite-service/contracts/openapi-report-v1.fragment.yaml
  Schema hash (blessed): bb333a3a
GATES: PASS — contracts aligned (openapi+snapshot updated, response_hash required)
[02-contracts] PASS (0s)
[03-ajv-validation] Running: tools/gates/03-ajv-validation.mjs
GATES: Phase 3 — Ajv runtime validation
GATES: PASS — runtime validation OK (12/12 bounds)
[03-ajv-validation] PASS (0s)
[04-model-averaging] Running: tools/gates/04-model-averaging.mjs
GATES: Phase 4 — Model averaging
GATES: PASS — BMA stable (resp_hash=a0136106, bma_hash=5c128992, K=1000, mass=1)
[04-model-averaging] PASS (0s)
[05-actions-reward] Running: tools/gates/05-actions-reward.mjs
GATES: Phase 5 — Actions, reward, explainability
GATES: PASS — actions+reward OK (best=set_fixed, regret=8.2059, top_k=3)
[05-actions-reward] PASS (0s)
[06-slos-perf] Running: tools/gates/06-slos-perf.mjs
GATES: Phase 6 — SLOs & performance
{"level":30,"time":1759757734984,"pid":10405,"hostname":"MacBookAir.net","msg":"Server listening at http://127.0.0.1:14312"}
{"level":30,"time":1759757735010,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1","route":"/draft-flows","statusCode":200,"durationMs":2.314917,"msg":"request completed"}
{"level":30,"time":1759757735010,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-2","route":"/draft-flows","statusCode":304,"durationMs":0.294708,"msg":"request completed"}
{"level":30,"time":1759757735010,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-3","route":"/draft-flows","statusCode":200,"durationMs":0.253375,"msg":"request completed"}
{"level":30,"time":1759757735012,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-4","route":"/draft-flows","statusCode":200,"durationMs":0.276667,"msg":"request completed"}
{"level":30,"time":1759757735016,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-5","route":"/draft-flows","statusCode":200,"durationMs":0.256833,"msg":"request completed"}
{"level":30,"time":1759757735017,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-6","route":"/draft-flows","statusCode":200,"durationMs":0.267541,"msg":"request completed"}
{"level":30,"time":1759757735018,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-7","route":"/draft-flows","statusCode":200,"durationMs":0.176625,"msg":"request completed"}
{"level":30,"time":1759757735018,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-8","route":"/draft-flows","statusCode":200,"durationMs":0.207125,"msg":"request completed"}
{"level":30,"time":1759757735020,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-9","route":"/draft-flows","statusCode":200,"durationMs":0.245666,"msg":"request completed"}
{"level":30,"time":1759757735022,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-a","route":"/draft-flows","statusCode":200,"durationMs":0.951333,"msg":"request completed"}
{"level":30,"time":1759757735023,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-b","route":"/draft-flows","statusCode":200,"durationMs":0.221292,"msg":"request completed"}
{"level":30,"time":1759757735024,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-c","route":"/draft-flows","statusCode":200,"durationMs":0.128542,"msg":"request completed"}
{"level":30,"time":1759757735025,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-d","route":"/draft-flows","statusCode":200,"durationMs":0.332,"msg":"request completed"}
{"level":30,"time":1759757735026,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-e","route":"/draft-flows","statusCode":200,"durationMs":0.128583,"msg":"request completed"}
{"level":30,"time":1759757735027,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-f","route":"/draft-flows","statusCode":200,"durationMs":0.188541,"msg":"request completed"}
{"level":30,"time":1759757735027,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-g","route":"/draft-flows","statusCode":200,"durationMs":0.110916,"msg":"request completed"}
{"level":30,"time":1759757735028,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-h","route":"/draft-flows","statusCode":200,"durationMs":0.0955,"msg":"request completed"}
{"level":30,"time":1759757735029,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-i","route":"/draft-flows","statusCode":200,"durationMs":0.104792,"msg":"request completed"}
{"level":30,"time":1759757735031,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-j","route":"/draft-flows","statusCode":200,"durationMs":0.29225,"msg":"request completed"}
{"level":30,"time":1759757735032,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-k","route":"/draft-flows","statusCode":200,"durationMs":0.115708,"msg":"request completed"}
{"level":30,"time":1759757735032,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-l","route":"/draft-flows","statusCode":200,"durationMs":0.093875,"msg":"request completed"}
{"level":30,"time":1759757735032,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-m","route":"/draft-flows","statusCode":200,"durationMs":0.085833,"msg":"request completed"}
{"level":30,"time":1759757735033,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-n","route":"/draft-flows","statusCode":200,"durationMs":0.131834,"msg":"request completed"}
{"level":30,"time":1759757735033,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-o","route":"/draft-flows","statusCode":200,"durationMs":0.145,"msg":"request completed"}
{"level":30,"time":1759757735034,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-p","route":"/draft-flows","statusCode":200,"durationMs":0.089834,"msg":"request completed"}
{"level":30,"time":1759757735034,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-q","route":"/draft-flows","statusCode":200,"durationMs":0.090083,"msg":"request completed"}
{"level":30,"time":1759757735035,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-r","route":"/draft-flows","statusCode":200,"durationMs":0.082292,"msg":"request completed"}
{"level":30,"time":1759757735035,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-s","route":"/draft-flows","statusCode":200,"durationMs":0.085,"msg":"request completed"}
{"level":30,"time":1759757735036,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-t","route":"/draft-flows","statusCode":200,"durationMs":0.083375,"msg":"request completed"}
{"level":30,"time":1759757735036,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-u","route":"/draft-flows","statusCode":200,"durationMs":0.08025,"msg":"request completed"}
{"level":30,"time":1759757735037,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-v","route":"/draft-flows","statusCode":200,"durationMs":0.075083,"msg":"request completed"}
{"level":30,"time":1759757735037,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-w","route":"/draft-flows","statusCode":200,"durationMs":0.24325,"msg":"request completed"}
{"level":30,"time":1759757735038,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-x","route":"/draft-flows","statusCode":200,"durationMs":0.16925,"msg":"request completed"}
{"level":30,"time":1759757735039,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-y","route":"/draft-flows","statusCode":200,"durationMs":0.198333,"msg":"request completed"}
{"level":30,"time":1759757735040,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-z","route":"/draft-flows","statusCode":200,"durationMs":0.0995,"msg":"request completed"}
{"level":30,"time":1759757735040,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-10","route":"/draft-flows","statusCode":200,"durationMs":0.104625,"msg":"request completed"}
{"level":30,"time":1759757735041,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-11","route":"/draft-flows","statusCode":200,"durationMs":0.082125,"msg":"request completed"}
{"level":30,"time":1759757735043,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-12","route":"/draft-flows","statusCode":200,"durationMs":0.18375,"msg":"request completed"}
{"level":30,"time":1759757735044,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-13","route":"/draft-flows","statusCode":200,"durationMs":0.097584,"msg":"request completed"}
{"level":30,"time":1759757735044,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-14","route":"/draft-flows","statusCode":200,"durationMs":0.102292,"msg":"request completed"}
{"level":30,"time":1759757735045,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-15","route":"/draft-flows","statusCode":200,"durationMs":0.237667,"msg":"request completed"}
{"level":30,"time":1759757735045,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-16","route":"/draft-flows","statusCode":200,"durationMs":0.132875,"msg":"request completed"}
{"level":30,"time":1759757735046,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-17","route":"/draft-flows","statusCode":200,"durationMs":0.069458,"msg":"request completed"}
{"level":30,"time":1759757735046,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-18","route":"/draft-flows","statusCode":200,"durationMs":0.067167,"msg":"request completed"}
{"level":30,"time":1759757735046,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-19","route":"/draft-flows","statusCode":200,"durationMs":0.071417,"msg":"request completed"}
{"level":30,"time":1759757735047,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1a","route":"/draft-flows","statusCode":200,"durationMs":0.068709,"msg":"request completed"}
{"level":30,"time":1759757735047,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1b","route":"/draft-flows","statusCode":200,"durationMs":0.066542,"msg":"request completed"}
{"level":30,"time":1759757735047,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1c","route":"/draft-flows","statusCode":200,"durationMs":0.075167,"msg":"request completed"}
{"level":30,"time":1759757735048,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1d","route":"/draft-flows","statusCode":200,"durationMs":0.065875,"msg":"request completed"}
{"level":30,"time":1759757735048,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1e","route":"/draft-flows","statusCode":200,"durationMs":0.138208,"msg":"request completed"}
{"level":30,"time":1759757735049,"pid":10405,"hostname":"MacBookAir.net","reqId":"req-1f","route":"/draft-flows","statusCode":200,"durationMs":0.070125,"msg":"request completed"}
GATES: PASS — slos OK (engine_get_p95_ms=3ms, K_per_sec=833333)
[06-slos-perf] PASS (1s)
[07-determinism] Running: tools/gates/07-determinism.mjs
GATES: Phase 7 — Determinism gates
GATES: PASS — determinism OK (strict+normalised, resp_hash=a0136106, bma_hash=5c128992, 10/10)
[07-determinism] PASS (0s)
[08-privacy-provenance] Running: tools/gates/08-privacy-provenance.mjs
GATES: Phase 8 — Privacy & provenance
GATES: PASS — privacy OK (0 violations)
[08-privacy-provenance] PASS (0s)
[09-engine-pack] Running: tools/gates/09-engine-pack.mjs
GATES: Phase 9 — Canonical engine pack
GATES: PASS — engine pack canonical (sha256=ae924f86 identical)
[09-engine-pack] PASS (0s)
[10-trust-chain] Running: tools/gates/10-trust-chain.mjs
GATES: Phase 10 — Trust chain & policy
GATES: PASS — trust GREEN (merge OK, signatures verified, licences OK)
[10-trust-chain] PASS (0s)
[11-schema-risk] Running: tools/gates/11-schema-risk.mjs
GATES: Phase 11 — Schema risk gate
GATES: PASS — schema compatible (risk=LOW)
[11-schema-risk] PASS (0s)
[12-ci-gate] Running: tools/gates/12-ci-gate.mjs
GATES: Phase 12 — CI one-step
GATES: PASS — CI gate chain green (pinned, artefacts uploaded)
[12-ci-gate] PASS (0s)
[13-status-docs] Running: tools/gates/13-status-docs.mjs
GATES: Phase 13 — Status & docs
GATES: PASS — status doc written
[13-status-docs] PASS (0s)

=== SUMMARY ===
Total duration: 2s
Completed: 2025-10-06T14:35:35+01:00

## Nightly Run — 2025-10-06T17:35:25.941Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=2ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T19:05:02.335Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=1ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T19:21:32.190Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=56ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T19:39:08.515Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=9ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T20:36:54.246Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=34ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T20:48:16.801Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=50ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-06T23:46:39.732Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=50ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---

## Nightly Run — 2025-10-07T08:23:40.359Z

### GATES Results

- ✅ **Schema Risk**: LOW (181 additive fields)
- ✅ **Determinism**: resp_hash=`a0264f9c`, bma_hash=`23134876`
- ✅ **SLOs**: p95=50ms, K/sec=1250
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

⚠️ Sentinels: `p95_lt_floor` — Suspiciously fast metrics - verify not using mocked data

### Artifacts

- `reports/schema-compat/{risk.json,schema-diff-b.md}`
- `out/diff.json`, `reports/bma/bma_runs.jsonl`
- `out/{slos.json,slos_samples.jsonl}`, `reports/diag/plausibility.json`
- `artifact/privacy/report.json`

---
