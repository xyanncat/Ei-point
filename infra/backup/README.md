# Backup and restore prerequisites

The host scripts require Bash, Docker, Node.js, Python 3, GNU `timeout`, `flock`, and restic. Run the systemd services as root against the local Docker engine; Docker Desktop and remote Docker volume mountpoints are not supported by the host restic script. Keep `/srv/ei-point/.env` root-readable only and set `ENV_FILE` explicitly when running scripts manually.

The PostgreSQL image is built from `infra/backup/Dockerfile`. Mount the `pgbackrest` named volume at `/var/lib/pgbackrest`, the configuration at `/etc/pgbackrest/pgbackrest.conf`, and enable PostgreSQL archive mode and `pgbackrest --stanza=ei-point archive-push %p`. The image creates the repository directory with PostgreSQL ownership before Docker initializes a new volume. Existing volumes must already have that ownership; do not repair ownership on a running repository without an operator maintenance plan.

`local-backup.sh` runs `stanza-create`, checks WAL archival, and takes a real incremental pgBackRest backup (pgBackRest creates the initial full backup when no base exists) in addition to creating the logical bundle. A failed physical command prevents publication of the bundle. Completed bundles contain `backup.json`, `postgres.dump`, `roles.sql`, and `artwork.tar.gz`. The manifest binds each artifact's size and SHA-256 digest. Role passwords are deliberately omitted; preserve application credentials through the encrypted deployment environment backup.

Configure `RESTIC_REPOSITORY` to an off-host URL and `RESTIC_PASSWORD` in the deployment environment. Initialize the encrypted restic repository deliberately using the same settings and `restic init`, then verify `restic snapshots` before enabling `ei-point-restic-backup.timer`. A missing configuration, inaccessible repository, or authentication failure causes the service to fail; it never initializes automatically. The private/secret set — `CYRENE_REFERENCE_AUDIO_PATH`, `CYRENE_PERSONA_MEMORY_FILE`, `ENV_FILE` — and the unique/private Docker volumes (`artwork`, `pgbackrest`) are resolved from the checked-in inventory (`infra/backup/durable-assets.mjs`; operator view: `docs/operations/durable-assets.md`). Public model weights are reprovisioned from their pinned manifests and are deliberately excluded. A required private asset that is unset or missing refuses the backup before any repository call. The local and off-host scripts share a lock. A local backup that overlaps a timer run causes that off-host run to fail visibly and retry at the next scheduled activation.

### Google Drive as the off-host repository

restic has no native Google Drive backend, so Drive is reached through restic's `rclone:` backend — the supported route for services restic cannot speak natively:

```sh
# once, on the backup host, with a dedicated backup account
rclone config                      # remote name: drive, type: drive, scope: drive
export RCLONE_CONFIG=/root/.config/rclone/rclone.conf
export RESTIC_REPOSITORY=rclone:drive:eipoint-backup
export RESTIC_PASSWORD='<from the operator secret store>'
restic init                        # deliberate operator action, never automatic
restic snapshots                   # verify before enabling the timer
```

`RESTIC_REPOSITORY=rclone:drive:<path>` is accepted by `restic-backup.sh`; the script refuses to run an `rclone:` repository when the `rclone` binary is missing or when `RCLONE_CONFIG` is unset or points at a missing file. `gs:` (Google Cloud Storage), `s3:`, `b2:`, `azure:`, `sftp:` and `rest:` remain supported, so the repository can move without changing the script. restic encrypts and deduplicates before upload, so the Drive account only ever stores ciphertext and incremental snapshots; the remote never sees a plaintext database, persona file or reference audio. Use a dedicated account rather than a personal login, and expect the Drive API to be the slowest transport: restic packs and deduplicates, so routine snapshots stay small, but a full repository rebuild moves far more data.

Run a logical drill against an explicit artifact directory:

```sh
BACKUP_SNAPSHOT=/srv/backups/20261014T120000Z bash scripts/restore-drill.sh
```

The drill verifies artifact hashes before any Docker operation, restores roles and the custom-format dump into an isolated container without network access, reads the restored database, and extracts artwork while checking every regular file's bytes. Links, special files, duplicate files and traversal paths are rejected. `READY_SECONDS` defaults to 60 and total `RTO_SECONDS` to 7200. A failure or timeout produces no PASS record. The drill does not deploy the restored service, measure an RPO, restore a remote restic snapshot, or perform physical WAL/PITR recovery. Those require separate measured staging drills before claiming production recovery acceptance.

Hermetic checks (Docker commands are mocked; no recovery certification):

```sh
node --test infra/backup/backup.test.mjs
```

Enable `ei-point-full-backup.timer` for a weekly physical full backup, in addition to the six-hour incremental/logical timer. The repository retains three weekly full backup chains; a fourteen-day physical/WAL window depends on these jobs succeeding and must be verified in the live restore drill. Weekly full failures retry after twenty minutes. This avoids retaining fifty-six full database copies from six-hour full backups. Monitor job success, repository space, WAL age and off-host snapshot age; timers alone are not an RPO guarantee.
