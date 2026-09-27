# Real enhanced-ISL sampling fixtures

Producer: `Talchain/Inference-Service-Layer` commit
`abe1d526916a078cecc425ff3f2d869922167dac`.

These complete request/response packets came from the actual FastAPI TestClient
route and robustness analyzer. They were not assembled from hand-written success
objects. `manifest.json` hashes every packet; the PLoT route test verifies those
hashes and the immutable producer identity before asserting carriage.

The durable producer-side replay is:

```sh
ISL_AUTH_DISABLED=true poetry run pytest tests/integration/test_science_statistics_wire.py -q -o addopts=''
```

Its original request/full-response baseline corpus is
`tests/fixtures/science_transport/base_enhanced_responses.json` in that ISL commit.
The export script `capture-isl-transport.py` is part of the parent lane's evidence
packet, not a script claimed to be committed in the ISL repository.

* `frequent_ties`: exact tie rate .91; realised `input->goal` inclusion .09.
* `rare_ties`: exact tie rate .07; inclusion .93.
* `no_ties`: exact tie rate zero; inclusion 1.
* `not_computed`: genuine enhanced endpoint 422 response; no measurements.
* `old_producer`: original successful enhanced response at
  `28fe0c950f6ca5737f4555c863353d37b734dddf`; both new fields absent.

The PLoT route fixture test stubs only the service call and returns complete
producer bytes. The parent lane separately owns the actual cross-service HTTP
witness. Neither fixture replay alone establishes deployed or mounted UI usage.
