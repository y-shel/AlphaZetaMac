# AlphaZetaMac

A pet project: [Zetamac](https://arithmetic.zetamac.com) with a bit of statistics on top.

You do quick arithmetic drills, the same as on Zetamac. In the background the app watches how
long each problem takes you and works out which kinds of problems slow you down. Carrying?
Multiplying by 7? Answers with three digits? It tells you, and it tells you how sure it is.

It does not try to coach you. It only finds the slow spots. What you do about them is up to you.

Everything runs in your browser. No server, no account, no tracking. Your data stays on your
machine, and you can export it whenever you like.

## Goals

- Show the kinds of problems that cost you the most points per round.
- Never claim more than the data supports. Every finding says how sure it is.
- Let you test a hunch: "Test this" runs a short round of matched problems and gives a real yes or no.
- Keep the drill itself fast. A keypress never waits on the maths.
- Have fun building it, and learn some statistics along the way.

## How I'm building it

- **Spec first.** One design doc says what the app does and why. Code follows it.
- **Small plans.** Each stage is a plan of short tasks, each with its own tests.
- **AI agents do the typing, with review.** Each task is built by one agent and checked by another, then the whole stage gets a final review.
- **Tests on the statistics.** Simulated users with known weaknesses check that the app finds them, and does not invent ones that are not there.
- **A few rules that never bend.** The raw log of answers is the only source of truth. The maths is kept apart from the screen so it can be tested.

Built with TypeScript, React, Vite and Bun. Tests use Vitest and Playwright.

## Where it's at

| Stage | What | Status |
|---|---|---|
| 1 | The drill, saving answers, import and export | Done |
| 2 | A model of your speed on each kind of problem | Done |
| 3 | Finding weak spots, and the Dashboard | Done |
| 4 | "Test this" experiments and Train mode | Built, waiting to be merged |
| 5 | Not planned yet | |

## Run it

```
bun install
bun run dev
```

Then open the address it prints.
