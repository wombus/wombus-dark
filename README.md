# Wombus Dark

A dark-mode mission control for [Claude Code](https://claude.com/claude-code). True black, electric green, and a little Claude crab who keeps you company.

## Install

In Claude Code, type:

```
/plugin install wombus-dark --marketplace wombus/wombus-dark
```

Answer `y` to add the marketplace, press Enter to install for your user, and it's on: no restart needed.

**Best in [Ghostty](https://ghostty.org) or [kitty](https://sw.kovidgoyal.net/kitty/)**, which can draw real pixels. Other terminals get a block-character crab and everything else works the same. Sounds play on macOS.

To update later: `claude plugin update wombus-dark`.

## What you get

**A task board that keeps you on track.** Sessions often start fuzzy. Once the goal is clear, Claude turns it into a checklist in a side panel, with tasks and subtasks, like tickets. The item you're on breathes softly, and if you drift onto something unrelated, Claude says so and offers to add it. Boards are saved per project folder.

**A live chart of the session.** A big pixel-font percentage and a stock-style line that climbs as tasks get done, with a breathing dot at the tip.

**The Claude crab.** A tiny real-pixel crab beside the number. Mostly calm: it blinks, and every so often it looks around, hops, scuttles, waves, or squints contentedly. It taps its legs while Claude works, thinks with little dots, sleeps when you're away, and celebrates when the board is clear.

**A usage dashboard.** Model and thinking level, your 5-hour and weekly limits with reset times, context, tokens in/out/total (each reply counted once), compactions, session length in calm half-hour steps, cost, and mode. Bars glide to new values.

**A restyled conversation.** Your messages as dark chips, every tool call as a card that glows while it runs, a smooth green wave while Claude thinks, and a clean "Done in 12s" footer.

**Rainbow typing.** What you type in the prompt box shifts through a neon rainbow, letter by letter. `/wombus rainbow` turns it off or on.

**Little moments.** A boot sequence when a session starts, fireworks and a chime when the board clears, a starfield when you've been idle a few minutes.

## Commands

| Command | What it does |
| --- | --- |
| `/board` | Open the task board. Also `/board done 2.1`, `start 3`, `add <title>`, `clear`. |
| `/wombus party` | Fireworks. |
| `/wombus sleep` | Starfield. |
| `/wombus boot` | Replay the boot sequence. |
| `/wombus rainbow` | Rainbow typing on/off. |

## Optional: the decision log

Off by default. Turn it on in `/config` (**Decision log**) and Claude keeps a cross-project log of decisions, fixes, ideas and milestones in a small SQLite file (`~/.claude/wombus-dark/decisions.db` unless you choose another). You also get:

- a "pick up from" banner when you open a project, showing where you left off;
- `/log idea: try caching the API calls` to add an entry yourself;
- `/decisions` for a panel of the log, this project or all of them;
- `/wrap` at the end of a session: Claude writes a summary and the next step.

Needs `sqlite3`, which macOS includes.

## Cost

Nearly everything runs locally and uses no tokens. The task board is the exception: a short note telling Claude how to use it rides along with each message (cached, so cheap), and each board update is a small tool call.

## License

MIT
