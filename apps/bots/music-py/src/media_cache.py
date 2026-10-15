"""Bounded local audio cache. Only hashed regular files are managed or evicted."""
import asyncio
import collections
import hashlib
import os
import pathlib
import re
import shutil
import time
import uuid

class AudioCache:
    def __init__(self, directory, max_bytes=10*1024**3, max_item_bytes=50*1024**2,
                 ttl_seconds=7*86400, minimum_free_ratio=0.1):
        self.root = pathlib.Path(directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        if not 0 < max_item_bytes <= max_bytes <= 10*1024**3 or ttl_seconds <= 0:
            raise ValueError('Invalid bounded cache limits')
        self.max_bytes, self.max_item_bytes, self.ttl = max_bytes, max_item_bytes, ttl_seconds
        self.minimum_free_ratio = minimum_free_ratio
        self.pinned = collections.Counter()
        self.lock = asyncio.Lock()
        # Crashed writers leave bounded staging files; never follow links or touch unrelated files.
        for path in self.root.glob('.partial-*'):
            if re.fullmatch(r'\.partial-[a-f0-9]{32}', path.name) and not path.is_symlink() and path.is_file() and time.time()-path.stat().st_mtime > 3600:
                path.unlink()

    def managed_path(self, path):
        p = pathlib.Path(path)
        return p.parent == self.root and bool(re.fullmatch(r'[a-f0-9]{64}\.audio', p.name)) and not p.is_symlink() and p.is_file()

    def lookup(self, key):
        path = self.root / (hashlib.sha256(key.encode()).hexdigest()+'.audio')
        if not self.managed_path(path): return None
        info = path.stat()
        if not 0 < info.st_size <= self.max_item_bytes or time.time()-info.st_mtime > self.ttl:
            if not self.pinned.get(str(path), 0): path.unlink(missing_ok=True)
            return None
        os.utime(path, None)
        return str(path)

    def pin(self, path):
        if self.managed_path(path): self.pinned[str(path)] += 1

    def unpin(self, path):
        if self.pinned.get(str(path), 0) <= 1: self.pinned.pop(str(path), None)
        else: self.pinned[str(path)] -= 1

    async def fetch(self, key, download):
        async with self.lock:
            existing = self.lookup(key)
            if existing: return existing
            usage = shutil.disk_usage(self.root)
            if usage.free / usage.total <= self.minimum_free_ratio:
                raise ValueError('Disk hold: optional audio download is paused')
            temporary = self.root / ('.partial-'+uuid.uuid4().hex)
            destination = self.root / (hashlib.sha256(key.encode()).hexdigest()+'.audio')
            try:
                await asyncio.wait_for(download(temporary), timeout=30)
                if temporary.is_symlink() or not temporary.is_file() or not 0 < temporary.stat().st_size <= self.max_item_bytes:
                    raise ValueError('Downloaded audio exceeds item limit or is invalid')
                required = temporary.stat().st_size
                files = sorted((p for p in self.root.glob('*.audio') if self.managed_path(p)), key=lambda p:p.stat().st_mtime)
                total = sum(p.stat().st_size for p in files)
                for path in files:
                    if self.pinned.get(str(path), 0): continue
                    size = path.stat().st_size
                    if total+required > self.max_bytes or time.time()-path.stat().st_mtime > self.ttl:
                        path.unlink(); total -= size
                if total+required > self.max_bytes: raise ValueError('Cache quota occupied by active playback')
                os.replace(temporary, destination)
                return str(destination)
            finally:
                temporary.unlink(missing_ok=True)
