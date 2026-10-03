# AlphaZetaMac

This is my little Zetamac project.

I like doing arithmetic drills on [Zetamac](https://arithmetic.zetamac.com), and I kept
wondering which problems were actually slowing me down. Was it carrying? Sevens? Big answers?
So I started building my own version that keeps track and tells me.

It's the same drill, but it remembers how long each problem takes me and slowly works out where
my weak spots are. It doesn't try to fix them. It just points at them, and it's honest about how
sure it is. Everything stays in the browser, on my machine.

## What I want from it

- To see which kinds of problems cost me the most points.
- To trust what it tells me. If it isn't sure, it should say so.
- To be able to test a hunch and get a real answer.
- To keep the drill itself quick and nice to play.
- To learn some statistics while I'm at it.

## How I'm going about it

I wrote down what I wanted first, in one long design doc, and I build from that. The work is
split into stages, and each stage into small tasks with their own tests.

AI agents do a lot of the typing. One builds a task, another checks it, and I make the calls when
something is unclear. I test the statistics on made-up players with known weak spots, to make
sure the app finds them and doesn't invent ones that aren't there.

It's written in TypeScript and React, and runs on Vite and Bun.

## Where it's at

- Stage 1, the drill and saving my answers: done
- Stage 2, a model of my speed on each kind of problem: done
- Stage 3, finding weak spots, and a dashboard: done
- Stage 4, testing a hunch, and a Train mode: built, not merged yet
- Stage 5: no idea yet

## Running it

```
bun install
bun run dev
```
