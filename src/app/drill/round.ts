import { getOperation } from '../../domain/operations/registry';
import type { Keystroke, Problem, TrialTag } from '../../domain/types';

export interface Draw {
  problem: Problem;
  /** Absent means the session's default mode. */
  tag?: TrialTag;
}

export interface CompletedRecord {
  problem: Problem;
  tag?: TrialTag;
  /** Same clock as the times passed to key(). */
  displayedAt: number;
  completedAt: number;
  /** This trial's keystrokes are keys[keyStart .. keyEnd). */
  keyStart: number;
  keyEnd: number;
}

export const KEYSTROKE_CAPACITY = 8192;

/**
 * One round of the drill, with no DOM. The drill component feeds it keys and copies
 * typed and problemText into the page.
 */
export class Round {
  readonly keys: Keystroke[];
  readonly completed: CompletedRecord[] = [];
  keyCount = 0;
  problem!: Problem;
  private tag: TrialTag | undefined;
  problemText = '';
  typed = '';
  private answerText = '';
  private displayedAt = 0;
  private trialKeyStart = 0;
  private readonly next: () => Draw;

  constructor(next: () => Draw, startedAt: number, capacity = KEYSTROKE_CAPACITY) {
    this.next = next;
    this.keys = new Array<Keystroke>(capacity);
    this.show(next(), startedAt);
  }

  /**
   * The hot path. Records the key, updates the typed string, compares it to the answer.
   * Returns true when this key completed the problem, in which case the next problem is
   * already showing. `t` is on the same clock as startedAt.
   */
  key(k: string, t: number): boolean {
    this.keys[this.keyCount++] = { k, t: t - this.displayedAt };
    if (k === 'Backspace') this.typed = this.typed.slice(0, -1);
    else if (k !== 'Delete') this.typed += k;
    if (this.typed !== this.answerText) return false;
    this.completed.push({
      problem: this.problem,
      ...(this.tag === undefined ? {} : { tag: this.tag }),
      displayedAt: this.displayedAt,
      completedAt: t,
      keyStart: this.trialKeyStart,
      keyEnd: this.keyCount,
    });
    this.show(this.next(), t);
    return true;
  }

  /** Runs once per completed problem, not per key. Rendering the next problem is unavoidable here. */
  private show({ problem, tag }: Draw, at: number): void {
    this.problem = problem;
    this.tag = tag;
    this.problemText = getOperation(problem.opId).render(problem.operands);
    this.answerText = String(problem.answer);
    this.displayedAt = at;
    this.typed = '';
    this.trialKeyStart = this.keyCount;
  }
}
