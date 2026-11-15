"""Export the locked dependencies around an official CPU Torch build for CI."""
from pathlib import Path
import subprocess
import sys
import tomllib

root = Path(__file__).resolve().parents[1]
packages = tomllib.loads((root / 'uv.lock').read_text())['package']
excluded = {'torch', 'triton'} | {
    p['name'] for p in packages if p['name'].startswith(('nvidia-', 'cuda-'))
}
command = ['uv', 'export', '--locked', '--no-hashes', '--no-emit-project']
for name in sorted(excluded):
    command += ['--no-emit-package', name]
subprocess.run(command, cwd=root, stdout=sys.stdout, check=True)
