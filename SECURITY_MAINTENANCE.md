# Dependency security maintenance

Use Node.js 24. Dependencies and lockfiles have been updated against the current advisory database. CI audits the full dependency graph and builds the application.

Run `npm ci`, `npm audit`, and `npm run build`.

The backend uses PyTorch 2.13 with official CUDA 13.0 wheels. Torchaudio was unused and removed; alignment already uses the custom implementation. CUDA 13 requires driver 580 or newer. The local RTX 5080 with driver 596.49 passed a GPU matrix calculation. See [NVIDIA compatibility guidance](https://docs.nvidia.com/deploy/cuda-compatibility/latest/minor-version-compatibility.html).

Run `uv sync --locked` and `uv run python -m unittest test_scoring test_voice -v` from `backend`. `python scripts/audit_lockfile.py` audits all locked dependencies, normalizing the official CUDA build tag to the public PyTorch version. CI tests the equivalent official CPU Torch build and exports the remaining dependencies from the same lock; it does not download GPU runtimes.

The full frontend `npm run check` and production build were verified locally using the existing checksum-matched resource files and recorded personal/research acknowledgment. No new resource terms were accepted. CI runs the synthetic resource-installer tests, TypeScript and bundling without downloading restricted resources. Follow THIRD_PARTY.md before preparing real resources on a fresh machine.
