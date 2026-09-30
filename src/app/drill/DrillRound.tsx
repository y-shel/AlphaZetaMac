import { useEffect, useEffectEvent, useRef } from 'react';
import { uuidv7 } from '../../domain/uuidv7';
import type { SessionWriter } from '../modes/sessionWriter';
import type { Round } from './round';

/** What the drill needs when it starts a round. Times are on the performance.now() clock. */
export interface DrillStart {
  startedAt: number;
  /** Date.now() - performance.now() at round start. Round clock + this = epoch ms. */
  epochOffset: number;
  seed: number;
  newId: (epochMs: number) => string;
}

/** One mode's round: Normal, Test, and later Train. Built once per round by the start prop. */
export interface DrillController {
  round: Round;
  writer: SessionWriter;
  /** Keys at or after this round-clock time are dropped. Infinity when the round has no time limit. */
  deadline: number;
  /** Banner text, such as "Seconds left: 42" or "37 / 100". Called on each tick and after each completed problem. */
  status(now: number): string;
  /** True once the round should end. Checked on each 100 ms tick. */
  over(now: number): boolean;
  /** Runs after a problem completes, outside the keydown handler. */
  afterComplete?: () => void;
}

export interface DrillEnd<C extends DrillController> {
  controller: C;
  score: number;
  /** Settles when the final flush has been written, or fails. */
  saved: Promise<void>;
}

interface Props<C extends DrillController> {
  start: (s: DrillStart) => C;
  onEnd: (end: DrillEnd<C>) => void;
}

const newId = (epochMs: number) => uuidv7(epochMs, crypto.getRandomValues(new Uint8Array(10)));

function isTrialKey(k: string): boolean {
  return k === 'Backspace' || k === 'Delete' || (k.length === 1 && k >= '0' && k <= '9');
}

/**
 * The drill. React renders the elements once. After that, every update is a direct DOM
 * write, and nothing in the keydown handler touches React state (spec 5.3).
 */
export function DrillRound<C extends DrillController>({ start, onEnd }: Props<C>) {
  const statusRef = useRef<HTMLSpanElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const problemRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read once when the round starts. A prop that changes mid-round must not restart it.
  const begin = useEffectEvent((s: DrillStart) => start(s));
  const finish = useEffectEvent((end: DrillEnd<C>) => onEnd(end));

  useEffect(() => {
    const statusEl = statusRef.current;
    const scoreEl = scoreRef.current;
    const problemEl = problemRef.current;
    const input = inputRef.current;
    if (!statusEl || !scoreEl || !problemEl || !input) return;

    const startedAt = performance.now();
    // The monotonic clock pauses during system sleep, so timeOrigin drifts from real time.
    const epochOffset = Date.now() - startedAt;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const controller = begin({ startedAt, epochOffset, seed, newId });
    const { round, writer, deadline } = controller;
    let statusShown = controller.status(startedAt);
    let ended = false;

    statusEl.textContent = statusShown;
    scoreEl.textContent = 'Score: 0';
    problemEl.textContent = round.problemText;
    input.value = '';
    input.focus();

    // The hot path: record, write the value, compare. Problem, score and status text change
    // only when a problem completes.
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.timeStamp >= deadline) {
        e.preventDefault();
        return;
      }
      const k = e.key;
      if (!isTrialKey(k)) {
        if (k.length === 1) e.preventDefault();
        return;
      }
      e.preventDefault();
      if (round.key(k, e.timeStamp)) {
        problemEl!.textContent = round.problemText;
        scoreEl!.textContent = `Score: ${round.completed.length}`;
        statusShown = controller.status(e.timeStamp);
        statusEl!.textContent = statusShown;
        if (controller.afterComplete) setTimeout(controller.afterComplete, 0);
      }
      input!.value = round.typed;
    }
    const blockInput = (e: Event) => e.preventDefault();
    const keepFocus = () => {
      if (!ended) input.focus();
    };
    const onVisibility = () => {
      // A failed write here is retried by the round-end flush, which reports failures.
      if (document.visibilityState === 'hidden') writer.flush().catch(() => undefined);
    };

    const interval = setInterval(() => {
      const now = performance.now();
      if (controller.over(now)) {
        stop();
        finish({ controller, score: round.completed.length, saved: writer.flush(Math.min(now, deadline)) });
        return;
      }
      const text = controller.status(now);
      if (text !== statusShown) {
        statusShown = text;
        statusEl.textContent = text;
      }
    }, 100);

    function stop() {
      ended = true;
      clearInterval(interval);
      input!.removeEventListener('keydown', onKeyDown);
      input!.removeEventListener('beforeinput', blockInput);
      input!.removeEventListener('blur', keepFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    }

    input.addEventListener('keydown', onKeyDown);
    input.addEventListener('beforeinput', blockInput);
    input.addEventListener('blur', keepFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return stop;
  }, []);

  return (
    <div className="drill">
      <div className="drill-banner">
        <span data-testid="timer" ref={statusRef} />
        <span data-testid="score" ref={scoreRef} />
      </div>
      <div className="drill-line">
        <span data-testid="problem" ref={problemRef} /> ={' '}
        <input
          className="drill-answer"
          data-testid="answer"
          ref={inputRef}
          inputMode="numeric"
          autoComplete="off"
          aria-label="Answer"
        />
      </div>
    </div>
  );
}
