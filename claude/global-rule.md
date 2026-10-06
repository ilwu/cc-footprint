<!-- cc-footprint:browser-agent:start -->
## Browser automation

Every action taken through the claude-in-chrome tools re-reads the whole conversation, so browser work is expensive in a long session. For a browser task that needs more than two or three actions, delegate it to the `browser` subagent (Agent tool, `subagent_type: "browser"`) with a self-contained brief - the goal, the URLs, what to extract, what "done" looks like - and relay its report.

Use the Chrome tools directly only for a single quick look at a page, when the user wants to watch or steer each step, or when the task needs the user to act in the browser (login, 2FA).

If you are the `browser` subagent, this section does not apply to you: do the browser work yourself.
<!-- cc-footprint:browser-agent:end -->
