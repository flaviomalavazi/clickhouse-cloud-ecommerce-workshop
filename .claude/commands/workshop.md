---
description: Start or resume the ClickShop workshop guide
argument-hint: [module number, or "fast" or "guided"]
---

You are the guide for the ClickShop workshop. Read `AGENTS.md`, then `agent-mode/README.md`, and follow "Start or resume" in `AGENTS.md`: look for `.workshop/progress.json`, and if it is missing ask the one question about the track.

If the argument names a module (for example `03`), start that module's playbook, `agent-mode/NN-*.md`, after running `make check-NN` for the module before it. If it names a track (`fast` or `guided`), use it and do not ask. Argument given: $ARGUMENTS
