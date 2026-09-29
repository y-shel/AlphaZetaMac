import { useEffect, useEffectEvent, useRef } from 'react';
import type { Settings } from '../../data/settings';
import { createProblemSource } from '../../domain/operations/registry';
import { createRng } from '../../domain/rng';
import { uuidv7 } from '../../domain/uuidv7';
import { Round } from '../drill/round';
import { NormalSession, type SaveRound } from './normalSession';

export interface RoundResult {
  score: number;
  /** Settles when the final flush has been written, or fails. */
  saved: Promise<void>;
}

interface Props {
  settings: Settings;
  save: SaveRound | null;
  onEnd: (result: RoundResult) => void;
}

const newId = (epochMs: number) => uuidv7(epochMs, crypto.getRandomValues(new Uint8Array(10)));

function isTrialKey(k: string): boolean {
  return k === 'Backspace' || k === 'Delete' || (k.length === 1 && k >= '0' && k <= '9');
}

/**
 * The drill. React renders the elements once. After that, every update is a direct DOM
 * write, and nothing in the keydown handler touches React state (spec 5.3).
 */
export function NormalRound({ settings, save, onEnd }: Props) {
  const timerRef = useRef<HTMLSpanElement>(null);
  const scoreRef = useRef<HTMLSpanElement>(null);
  const problemRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read once when the round starts. A prop that changes mid-round must not restart it.
  const readProps = useEffectEvent(() => ({ settings, save }));
  const finish = useEffectEvent((result: RoundResult) => onEnd(result));

  useEffect(() => {
    const timerEl = timerRef.current;
    const scoreEl = scoreRef.current;
    const problemEl = problemRef.current;
    const input = inputRef.current;
    if (!timerEl || !scoreEl || !problemEl || !input) return;

    const { settings, save } = readProps();
    const startedAt = performance.now();
    // The monotonic clock pauses during system sleep, so timeOrigin drifts from real time.
    const epochOffset = Date.now() - startedAt;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const round = new Round(createProblemSource(settings.params, createRng(seed)), startedAt);
    const session = new NormalSession(round, settings.params, settings.durationS, startedAt, {
      sessionId: newId(epochOffset + startedAt),
      save,
      timeOrigin: epochOffset,
      newId,
    });
    const deadline = startedAt + settings.durationS * 1000;
    let secondsShown: number = settings.durationS;
    let ended = false;

    timerEl.textContent = `Seconds left: ${secondsShown}`;
    scoreEl.textContent = 'Score: 0';
    problemEl.textContent = round.problemText;
    input.value = '';
    input.focus();

    // The hot path: record, write the value, compare. Problem and score text change only
    // when a problem completes.
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
      }
      input!.value = round.typed;
    }
    const blockInput = (e: Event) => e.preventDefault();
    const keepFocus = () => {
      if (!ended) input.focus();
    };
    const onVisibility = () => {
      // A failed write here is retried by the round-end flush, which reports failures.
      if (document.visibilityState === 'hidden') session.flush().catch(() => undefined);
    };

    const interval = setInterval(() => {
      const left = Math.ceil((deadline - performance.now()) / 1000);
      if (left <= 0) {
        stop();
        finish({ score: round.completed.length, saved: session.flush(Math.min(performance.now(), deadline)) });
        return;
      }
      if (left !== secondsShown) {
        secondsShown = left;
        timerEl.textContent = `Seconds left: ${left}`;
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
        <span data-testid="timer" ref={timerRef} />
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
