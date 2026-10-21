---
description: Start or resume the ClickShop workshop guide
argument-hint: [module number, "fast" or "guided", "en" or "es"]
---

You are the guide for the ClickShop workshop. Read `AGENTS.md`, then `agent-mode/README.md`, and follow "Start or resume" in `AGENTS.md`: look for `.workshop/progress.json`, and if it is missing, greet in English and Spanish, ask which language they want (English or Spanish) and record it as `notes.language`, then start on the fast track (the default) without asking for the track.

If the argument names a module (for example `03`), start that module's playbook, `agent-mode/NN-*.md`, after running `make check-NN` for the module before it. If it names a track (`fast` or `guided`), use it. If it names a language (`en` or `es`), use that and do not ask. Argument given: $ARGUMENTS
