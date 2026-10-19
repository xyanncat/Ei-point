# Ei Point repository rules

- **Always commit and push every change in the same work session.** Code, tests, configs,
  runbooks and audit reports must not be left uncommitted or only in a local worktree.
- Keep `main` and the active feature branch (`feat/completion-plan`) in sync after each
  completed change; push both.
- Keep the VPS checkout `/opt/ei-point` pulled to the pushed revision. Rebuild/redeploy only
  the affected services; never restart model services or active voice/music sessions for a
  source-only sync.
- Never commit secrets, tokens, `.env` files, private keys, model weights or private reference
  audio. Owner prompts and audit reports are safe to commit after a secret scan.
- Record what is deployed (revision, image IDs, health) in the relevant audit report.
