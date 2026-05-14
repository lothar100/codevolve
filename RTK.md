# RTK - Rust Token Killer (Project Local)

Use `rtk` for shell commands in this repository when it reduces verbose output and token usage.

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

- Prefer `rtk ...` for shell-heavy, high-output commands.
- Use raw commands only when `rtk` would not help or would change the intended behavior.

Verification:

```bash
rtk --version
rtk gain
where rtk
```
