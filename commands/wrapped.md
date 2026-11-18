---
description: Make your Claude Code Wrapped for this year (local only, nothing uploaded)
argument-hint: "[--year 2026] [--demo]"
allowed-tools: Bash(npx -y github:openyard-cloud/agent-wrapped:*)
---

Run this command exactly, passing along any arguments the user gave:

```
npx -y github:openyard-cloud/agent-wrapped $ARGUMENTS
```

Then show the user the summary it printed, as it printed it, and the path of the page it wrote. Tell them the page opens in their browser, that they can tap through the story, and that the last slide has a card they can save as an image. Do not open, read or summarize the HTML file yourself, and do not add numbers of your own.
