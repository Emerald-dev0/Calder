# Calder Python client source

This client is implemented in `src/calder`, with repository tests in `tests/`.
Official PyPI publication and package provenance have not been verified for the
initial public launch. Use the [direct HTTP quickstart](https://calder.click/docs/quickstart/python)
now; do not assume an arbitrary PyPI package named `calder` is this client.

For local source validation from this directory:

```bash
# Install pytest in your development environment first.
PYTHONPATH=src python3 -m pytest tests
```

Publishing is a separate owner task after source tests, artifact inspection,
registry ownership verification and an install-to-live smoke test. See
[SDK status](../README.md) and [launch availability](../../docs/LAUNCH-STATUS.md).
