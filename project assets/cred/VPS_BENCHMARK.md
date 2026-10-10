# EI-point — VPS Benchmark

> Measured on the live production VPS. Re-run with
> `bash deploy/vps/benchmark.sh /tmp/bench.txt` and refresh the tables below
> (keep the history section at the bottom). No secrets appear in this file.

**Host**: Vertex Node "Royal paradise" (`16fba480`, host `gooncat`) ·
**measured**: 2026-10-10 · **kernel**: Debian GNU/Linux 13 (trixie), 6.12.111-cloud

## Hardware

| Item | Value | Verdict |
|---|---|---|
| Virtualization | KVM full VM (QEMU, Intel 440FX chipset, virtio balloon/console) | standard VPS |
| CPU | 10 vCPU · 1 socket × 10 cores × 1 thread · "Common KVM processor" (qemu64) | ⚠️ minimal feature set |
| CPU features | **no AVX / AVX2 / AES-NI / SSE4.2** (only `hypervisor`) | ⚠️ forces `mongo:4.4`, software crypto |
| Cache | L1d/L1i 32 KiB ×10 · L2 4 MiB ×10 · **L3 16 MiB** | |
| RAM (measured) | **62.8 GiB MemTotal** · 56.2 free · 59.6 available | ✅ |
| RAM (operator allocation model) | **48 GB RAM + 16 GB swap = 64 GB total** | design budget |
| Swap (measured) | **16 GiB swapfile on the SSD** (`swapon` type=file) · 0 used | ✅ disk-backed |
| Disk | **500 GB SSD** (`ROTA=0`) · `sda1` 499.9 G ext4 · 124 M EFI | ✅ |
| Mount options | `rw,relatime,discard,errors=remount-ro` (TRIM active) | ✅ |
| Disk usage | 36 G / 492 G (**8 %**) · docker store 11 G · 437 G free | ✅ |
| NIC | `ens18` · 10.0.0.75/24 (DHCP) · **no public IP** (funnel-only ingress) | ✅ |

## Performance

| Test | Result | Verdict |
|---|---:|---|
| AES-256-CBC | 54 → 188 MB/s | ⚠️ software AES (no AES-NI) |
| SHA-256 | 28 → 196 MB/s | ⚠️ weak per-core |
| Memory copy (4 GiB) | **16.7 GB/s** | ✅ |
| Disk write (512 MiB – 1 GiB) | **635 – 1200 MB/s** | ✅ SSD |
| Disk read (cached) | 6.3 – 6.4 GB/s | ✅ |
| Ping 8.8.8.8 | **1.456 ms** (jitter 0.010 ms) | ✅ excellent routing |
| WAN download (100 MB) | **40 Mbps** (5.0 MB/s in 20.9 s, HTTP 200) | 🟡 modest, contended |
| DNS host (cached) | 8 – 22 ms | ✅ (was 4 000–26 000 ms before the resolver fix) |
| DNS containers | 15 – 61 ms | ✅ (was failing) |
| Discord REST (command reply path) | **290 ms** | ✅ (was 4 233 ms) |
| Supabase internal (gateway TLS) | 239 ms | ✅ |

## OS & platform

| Item | Value |
|---|---|
| OS / kernel | Debian GNU/Linux 13 (trixie) · 6.12.111+deb13-cloud-amd64 |
| Packages | 347 installed · **0 upgradable** (unattended-upgrades active) |
| Journal | 118.8 MB (bounded) |
| Docker | engine **29.9.0** · compose **5.6.0** · 6 volumes · 7 networks |
| Images | eipoint-bots 1.08 GB · dashboard 1.51 GB · swish 916 MB · cipher 329 MB · hu-tao 311 MB · website 76 MB · mongo:7 1.18 GB · nginx 94 MB · tailscale 179 MB · cloudflared 98 MB |
| Timers | `eipoint-disk-guard` every 15 min · `eipoint-backup` daily 03:15 · dpkg-db-backup · e2scrub_all |

## All projects on the VPS

| Project | Containers | CPU quota | Mem cap | Actual mem | Data | Network |
|---|---:|---:|---:|---:|---:|---|
| EI-point fleet | 12 | 5 cores | 24 GiB | ~1.7 GiB | Mongo < 1 MB · repo 15 MB | `eipoint_eipoint-net` |
| Supabase (self-hosted) | 4 | (same slice) | (same) | ~175 MiB | Postgres **11 MB** (incl. auth) | `eipoint-supabase_supabase-net` |
| swish | 1 | 0.5 core | 3 GiB | 43 MiB | 208 KB | `swish-net` |
| Ei Paradise | 3 | 1.5 cores | 6 GiB | 77 MiB | 19 MB | `ei-paradise-net` |
| **TOTAL** | **20** | **7 / 10 cores** | **33 / 62 GiB** | **≈ 2.3 GiB** | **≈ 35 MB** | 4 isolated + 3 default |

## Score card

```
VPS COMPLETE BENCHMARK SCORECARD                                7.6 / 10
═══════════════════════════════════════════════════════════════════════════
Storage (SSD, TRIM, 8% used)          ███████████████████░   9.5
Memory (95% free)                     ███████████████████░   9.5
Fleet efficiency (20 ct · 2.3 GiB)    ██████████████████░░   9.0
OS hygiene (0 upgrades, timers)       ██████████████████░░   9.0
Application latency (290 ms)          ████████████████░░░░   8.0
Network quality (1.5 ms ping)         ████████████████░░░░   8.0
CPU capability (no AVX/AES-NI)        ███████████████░░░░░   7.5
WAN throughput (40 Mbps)              ███████████████░░░░░   7.5
DNS resilience                        █████████████░░░░░░░   6.5
Security hardening (SSH/fw/f2b)       ████████████░░░░░░░░   6.0
Reliability (reboots, console)        ███████████░░░░░░░░░   5.5
Backup coverage                       ██████████░░░░░░░░░░   5.0
═══════════════════════════════════════════════════════════════════════════
```

## Findings register

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Postgres is never backed up (11 MB incl. auth users) | 🔴 | open |
| 2 | Ei Paradise backup is an empty 89-byte archive | 🔴 | open |
| 3 | swish has no backup | 🟠 | open |
| 4 | Backups are local-only (no off-host) | 🟠 | open |
| 5 | CPU lacks AVX/AES-NI → `mongo:4.4` pinned | 🟠 | provider fix (host-passthrough) |
| 6 | Provider network flakiness (DNS phases, npm failures) | 🟠 | mitigated (cached resolver + retries) |
| 7 | Two unexplained power-offs/reboots (2026-10-10) | 🟠 | ask provider |
| 8 | SSH: `PermitRootLogin yes` + password auth | 🟠 | needs operator SSH key |
| 9 | No ufw firewall · fail2ban inactive | 🟠 | needs operator SSH key |
| 10 | Console (coterm) serial socket flakiness | 🟡 | workaround: VM stop→start |
| 11 | shanks 23.7 % CPU spike (single sample) | 🟡 | monitoring |
| 12 | Blackholed resolver `1.1.1.1` in host + Docker config | ✅ | fixed 2026-10-10 |

## Redesign capacity budget (combined project)

| Resource | Specs | Current use | Combined budget | Reserve |
|---|---|---|---|---|
| CPU | 10 cores | 7 allocated · <5 % used | **8 cores quota** | 2 cores |
| RAM | 48 GB (operator model) + 16 GB swap | 2.3 GiB used | **40 GiB cap** | ~8 GiB |
| Disk | 492 GB | 36 GB (8 %) | **400 GB** | ~90 GB |
| WAN | 40 Mbps measured | idle | fine for bots + API | — |

**Constraints learned here:** CPU is the weak axis (no AVX/AES-NI) — keep
builds off the hot path and take the provider's host-passthrough fix when
offered; RAM and disk are effectively unlimited for this workload; bake the
cached-resolver + explicit Docker DNS config in from day one; one backup job
must cover Postgres + Mongo + all file data, verified and off-host.

## History

| Date | Overall | Notes |
|---|---:|---|
| 2026-10-10 | 7.6 | First full deep-check: 20 containers / 4 projects, resolver fix live (Discord REST 4 233 ms → 290 ms), disk 1.2 GB/s write, WAN 40 Mbps, 0 upgradable packages |
