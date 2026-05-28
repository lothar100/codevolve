# RTK - Rust Token Killer (Project Local)

Use `rtk` from PowerShell for shell commands in this repository when it reduces verbose output and token usage.

Prefer:

```bash
rtk git status
rtk git diff
rtk git log
rtk cargo test
rtk npm run build
rtk pytest -q
rtk grep "pattern" .
rtk read path/to/file
```

Rule:

- Use `rtk ...` for shell-heavy, high-output commands.
- Use raw PowerShell commands only when `rtk` would not help, does not support the command, or would change the intended behavior.

Verification:

```bash
rtk --version
rtk gain
where rtk
```
