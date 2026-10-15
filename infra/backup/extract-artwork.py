"""Extract regular artwork files only; verify each extracted byte against archive."""
import hashlib
import pathlib
import sys
import tarfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
root.mkdir(parents=True, exist_ok=False)
seen = set()
count = 0
with tarfile.open(archive, 'r:gz') as source:
    for entry in source:
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or '..' in path.parts or '\\' in entry.name or any(':' in part for part in path.parts):
            raise ValueError('Unsafe artwork path')
        if entry.isdir():
            root.joinpath(*path.parts).mkdir(parents=True, exist_ok=True)
            continue
        if not entry.isfile() or entry.name in seen:
            raise ValueError('Artwork archive contains link, device, or duplicate file')
        seen.add(entry.name)
        target = root.joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with source.extractfile(entry) as src, target.open('xb') as dst:
            while chunk := src.read(1024 * 1024):
                digest.update(chunk)
                dst.write(chunk)
        actual = hashlib.sha256()
        with target.open('rb') as restored:
            while chunk := restored.read(1024 * 1024):
                actual.update(chunk)
        if actual.digest() != digest.digest() or target.stat().st_size != entry.size:
            raise ValueError('Extracted artwork integrity mismatch')
        count += 1
print(f'Artwork verified: {count} regular files (empty volumes are allowed)')
