#!/usr/bin/env python3
"""Fingerprint the runtime sources, including uncommitted implementation files."""
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parent.parent
extensions = {'.go', '.proto', '.ts', '.tsx', '.js', '.css', '.json', '.svg', '.webp', '.png'}
files = list(root.glob('*.go')) + [root/'go.mod', root/'go.sum']
for folder in ('internal', 'proto', 'frontend'):
    files.extend(p for p in (root/folder).rglob('*') if p.is_file() and p.name != 'next-env.d.ts'
                 and not any(part in {'node_modules', '.next', 'gen', '.git'} for part in p.relative_to(root).parts)
                 and (p.suffix in extensions or p.name == 'bun.lockb'))
h = hashlib.sha256()
for p in sorted(set(files)):
    h.update(str(p.relative_to(root)).encode()); h.update(b'\0'); h.update(p.read_bytes()); h.update(b'\0')
print('source-' + h.hexdigest()[:16])
