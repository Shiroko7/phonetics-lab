"""Audit all locked public Python packages, including official CUDA wheel variants."""
import json
from pathlib import Path
import tomllib
from urllib.request import Request, urlopen

lock = Path(__file__).resolve().parents[1] / 'uv.lock'
packages = [p for p in tomllib.loads(lock.read_text())['package']
            if 'registry' in p.get('source', {})]
queries = []
for package in packages:
    version = package['version']
    if package['name'] == 'torch' and package['source']['registry'].startswith(
        'https://download.pytorch.org/whl/'
    ):
        # CUDA/CPU is a build tag; advisories apply to the public PyTorch version.
        version = version.split('+', 1)[0]
    queries.append({'package': {'ecosystem': 'PyPI', 'name': package['name']}, 'version': version})

findings = []
for start in range(0, len(packages), 100):
    request = Request('https://api.osv.dev/v1/querybatch',
                      data=json.dumps({'queries': queries[start:start + 100]}).encode(),
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=60) as response:
        results = json.load(response)['results']
    for package, result in zip(packages[start:start + 100], results, strict=True):
        for advisory in result.get('vulns', []):
            findings.append(f"{package['name']} {package['version']}: {advisory['id']}")
print(f'Checked {len(packages)} locked registry dependencies; {len(findings)} advisories.')
for finding in findings:
    print(finding)
raise SystemExit(bool(findings))
