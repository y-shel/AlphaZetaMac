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

It's written in TypeScript and React, and runs on Vite and Bun.

## Fair warning

This is far from done. There are inconsistencies and bugs, and a lot of things don't work yet.
If you try it and something breaks or looks wrong, I'd really appreciate it if you
[opened an issue](https://github.com/y-shel/AlphaZetaMac/issues) and told me about it.

## Running it

```
bun install
bun run dev
```
