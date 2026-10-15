#!/usr/bin/env python3
"""Read ZIPs in place: persist hashes, paths, and literal command declarations only."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
CACHE_PARTS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".turbo", ".mimosa", ".codex", ".agents", ".agent", "__macosx", "coverage", "logs", ".ssh", ".aws", ".azure", ".kube", ".gnupg"}
SECRET_EXTENSIONS = {".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db", ".log"}
SOURCE_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".html", ".css", ".sql", ".sh", ".yaml", ".yml", ".php", ".vue", ".svelte"}
JS_EXTENSIONS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
SOURCE_LIMIT = 8_000_000

def excluded(path: str):
    parsed = PurePosixPath(path.replace("\\", "/"))
    if parsed.is_absolute() or ".." in parsed.parts:
        return "unsafe-path"
    if any(part.lower() in CACHE_PARTS for part in parsed.parts):
        return "dependency-build-cache-or-agent-state"
    name = parsed.name.lower()
    if name == ".env" or name.startswith(".env.") or name.endswith(".env") or parsed.suffix.lower() in SECRET_EXTENSIONS:
        return "environment-secret-runtime-data"
    if name in {"id_rsa", "id_ed25519", "id_dsa", "id_ecdsa"}:
        return "potential-secret-runtime-file"
    if re.search(r"(^|[._-])(credentials?|secrets?|tokens?|cookies?|sessions?)([._-]|$)", name):
        return "potential-secret-runtime-file"
    return None

def safe_name(value):
    return value if isinstance(value,str) and re.fullmatch(r"[\w-]{1,40}",value) else None

def dotted(node):
    if isinstance(node,ast.Name): return node.id
    if isinstance(node,ast.Attribute):
        owner=dotted(node.value)
        return f"{owner}.{node.attr}" if owner else node.attr
    return None

def python_symbols(text):
    symbols=[]
    try: tree=ast.parse(text)
    except SyntaxError as error:
        return {"symbols":[],"parse_diagnostics":[{"code":"python-syntax-error","line":error.lineno}]}
    for node in ast.walk(tree):
        if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name.startswith("on_"):
            symbols.append({"kind":"event","name":node.name[3:],"line":node.lineno,"declaration":node.name,"detection":"python-ast-event-handler","resolution":"literal"})
        if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)): continue
        for decorator in node.decorator_list:
            owner=dotted(decorator.func) if isinstance(decorator,ast.Call) else dotted(decorator)
            if not owner: continue
            leaf=owner.rsplit(".",1)[-1]
            if leaf=="route" and isinstance(decorator,ast.Call) and decorator.args:
                path=decorator.args[0].value if isinstance(decorator.args[0],ast.Constant) else None
                methods=next((kw.value.elts for kw in decorator.keywords if kw.arg=="methods" and isinstance(kw.value,ast.List)),None)
                verbs=sorted(v.value.upper() for v in methods or [] if isinstance(v,ast.Constant) and isinstance(v.value,str)) or ["GET"]
                if isinstance(path,str) and path.startswith("/"):
                    for verb in verbs: symbols.append({"kind":"route","name":f"{verb} {path}","line":decorator.lineno,"declaration":node.name,"detection":"python-ast-route-decorator","resolution":"literal"})
                continue
            if leaf=="loop" or owner.endswith("tasks.loop"):
                symbols.append({"kind":"scheduled job","name":node.name,"line":decorator.lineno,"declaration":node.name,"detection":"python-ast-task-loop","resolution":"literal"})
                continue
            if leaf in {"button","select"} and isinstance(decorator,ast.Call):
                custom_id=next((kw.value.value for kw in decorator.keywords if kw.arg=="custom_id" and isinstance(kw.value,ast.Constant) and isinstance(kw.value.value,str)),None)
                if custom_id: symbols.append({"kind":"component","name":custom_id,"line":decorator.lineno,"declaration":node.name,"detection":"python-ast-component-decorator","resolution":"literal"})
                continue
            if leaf not in {"command","hybrid_command","group","hybrid_group"} or not isinstance(decorator,ast.Call): continue
            keyword=next((kw.value for kw in decorator.keywords if kw.arg=="name"),None)
            name=safe_name(keyword.value) if isinstance(keyword,ast.Constant) else safe_name(node.name) if keyword is None else None
            kind="hybrid-command" if "hybrid_" in owner else "prefix-command" if owner.startswith("commands.") else "slash-command" if owner.startswith("app_commands.") or ".tree." in owner else "decorated-command-context-unresolved"
            symbols.append({"kind":kind,"name":name,"parent_command":None,"line":decorator.lineno,"declaration":node.name,"decorator":owner,"detection":"python-ast-decorator","resolution":"literal" if name else "dynamic-name-unresolved"})
    for node in ast.walk(tree):
        if not isinstance(node,ast.Constant) or not isinstance(node.value,str): continue
        if re.search(r"(?:^|[\\/])(?:assets?|public|images?)[\\/].+\.(?:png|jpe?g|webp|gif|svg|mp3|ogg|wav|woff2?)$",node.value,re.I):
            symbols.append({"kind":"asset flow","name":node.value,"line":getattr(node,"lineno",1),"declaration":"string-literal-reference","detection":"python-ast-asset-reference","resolution":"literal"})
    return {"symbols":symbols,"parse_diagnostics":[]}

class SymbolParser:
    def __init__(self):
        self.worker=subprocess.Popen([os.environ.get("INVENTORY_NODE","node"),str(ROOT/"scripts/inventory-archives.mjs"),"--symbols"],stdin=subprocess.PIPE,stdout=subprocess.PIPE,encoding="utf-8",creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    def analyze(self,path,text):
        if Path(path).suffix.lower()==".py": return python_symbols(text)
        if Path(path).suffix.lower() not in JS_EXTENSIONS: return {"symbols":[]}
        self.worker.stdin.write(json.dumps({"path":path,"text":text},ensure_ascii=True)+"\n")
        self.worker.stdin.flush()
        line=self.worker.stdout.readline()
        if not line: raise RuntimeError("TypeScript symbol parser stopped")
        return json.loads(line)
    def close(self):
        self.worker.stdin.close()
        if self.worker.wait(timeout=15)!=0: raise RuntimeError("TypeScript parser failed")

def file_hash(path):
    digest=hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""): digest.update(block)
    return digest.hexdigest()

def targets(parser):
    result=[]
    for path in sorted((ROOT/"apps/bots").rglob("*")):
        if not path.is_file(): continue
        relative=path.relative_to(ROOT).as_posix()
        if excluded(relative) or path.suffix.lower() not in JS_EXTENSIONS|{".py"} or "tests" in path.parts or ".test." in path.name: continue
        for symbol in parser.analyze(relative,path.read_text(encoding="utf-8-sig")).get("symbols",[]):
            result.append({"file":relative,**symbol})
    return result

def scan_archive(path,parser,target_index):
    entries=[]
    excluded_counts=Counter()
    with ZipFile(path) as archive:
        for entry in sorted(archive.infolist(),key=lambda info:info.filename):
            if entry.is_dir(): continue
            name=entry.filename.replace("\\","/")
            reason=excluded(name)
            if reason:
                excluded_counts[reason]+=1
                continue
            digest=hashlib.sha256()
            source=bytearray()
            is_source=PurePosixPath(name).suffix.lower() in SOURCE_EXTENSIONS
            with archive.open(entry) as stream:
                for block in iter(lambda:stream.read(1024*1024),b""):
                    digest.update(block)
                    if is_source and entry.file_size<=SOURCE_LIMIT: source.extend(block)
            record={"path":name,"bytes":entry.file_size,"sha256":digest.hexdigest(),"source_file":is_source}
            if is_source:
                if entry.file_size>SOURCE_LIMIT: record["symbol_scan"]="source-byte-limit-unresolved"
                else:
                    try: text=source.decode("utf-8-sig")
                    except UnicodeDecodeError:
                        record["symbol_scan"]="non-utf8-source-unresolved"
                    else:
                        scan=parser.analyze(name,text)
                        record.update(scan)
                        for symbol in record.get("symbols",[]):
                            command_kind=symbol.get("kind") in {"slash-command","context-command","subcommand","subcommand-group","prefix-command","hybrid-command"}
                            candidates=target_index.get(symbol["name"],[]) if symbol["name"] and command_kind else []
                            symbol["target_candidates"]=candidates
                            symbol["parity_status"]="semantic-parity-unverified" if candidates else "no-exact-name-target-candidate" if command_kind else "source-level-target-trace-required"
            entries.append(record)
    symbols=[symbol for entry in entries for symbol in entry.get("symbols",[])]
    command_kinds={"slash-command","context-command","subcommand","subcommand-group","prefix-command","hybrid-command"}
    commands=[symbol for symbol in symbols if symbol.get("kind") in command_kinds]
    return {"archive":path.name,"archive_bytes":path.stat().st_size,"archive_sha256":file_hash(path),
        "counts":{"included_files":len(entries),"source_files":sum(entry["source_file"] for entry in entries),"command_symbols":len(commands),"capability_symbols":len(symbols),"capability_kind_counts":dict(sorted(Counter(symbol.get("kind","unknown") for symbol in symbols).items())),"symbols_with_exact_name_candidates":sum(bool(symbol.get("target_candidates")) for symbol in commands),"symbols_without_exact_name_candidates":sum(not symbol.get("target_candidates") for symbol in commands)},
        "excluded_counts":dict(sorted(excluded_counts.items())),"files":entries}

def main():
    options=argparse.ArgumentParser(description=__doc__)
    options.add_argument("--archive-dir",type=Path,default=os.environ.get("LEGACY_ARCHIVE_DIR"),
        help="directory containing Ei Paradise.zip, EI-point.zip and swish.zip (or set LEGACY_ARCHIVE_DIR)")
    options.add_argument("--output",type=Path,default=ROOT/"docs/archive-command-inventory.json")
    args=options.parse_args()
    if args.archive_dir is None:
        options.error("--archive-dir or LEGACY_ARCHIVE_DIR is required")
    parser=SymbolParser()
    try:
        target_symbols=targets(parser)
        target_index={}
        for symbol in target_symbols:
            if symbol["name"]: target_index.setdefault(symbol["name"],[]).append(symbol)
        archives=[]
        for name in ("Ei Paradise.zip","EI-point.zip","swish.zip"):
            path=args.archive_dir/name
            if not path.is_file(): raise FileNotFoundError(f"Required archive missing: {name}")
            archives.append(scan_archive(path,parser,target_index))
        report={"schema_version":2,"scope":"All three original ZIPs, all files remaining after explicit exclusion rules; no source contents extracted or persisted",
            "status":"inventory-only-semantic-parity-unverified","generated_by":"node scripts/inventory-archives.mjs",
            "exclusions":{"directory_parts":sorted(CACHE_PARTS),"suffixes":sorted(SECRET_EXTENSIONS),"environment_files":".env, .env.*, *.env (including examples)","potential_secret_filenames":"credentials, secrets, tokens, cookies, sessions delimited by dot, underscore or dash", "unsafe_paths":"absolute or parent traversal"},
            "limitations":["Command, event, route, component, scheduled-job and static asset-path declarations are heuristically extracted; dynamic registrations and other frameworks require manual review.","Options are excluded from command names; subcommands are distinguished from root SlashCommandBuilder declarations.","Exact-name target declarations are search candidates, not proof of dispatch, authorization, semantics, persistence, failure behavior or acceptance coverage.","Static declarations can be unused, conditional or incomplete; every behavior still requires source-level semantic traceability.","Generated, dependency, cache, agent state, environment and potential secret/runtime files are excluded explicitly; source files above eight megabytes or non-UTF8 encodings remain unresolved."],
            "target_candidates":target_symbols,"archives":archives}
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({"output":args.output.relative_to(ROOT).as_posix() if args.output.is_relative_to(ROOT) else str(args.output),"archives":[{"archive":archive["archive"],**archive["counts"]} for archive in archives]},indent=2))
    finally: parser.close()

if __name__=="__main__": main()
