interface Props {
  score: number;
  onAgain: () => void;
  onSettings: () => void;
}

export function ScoreScreen({ score, onAgain, onSettings }: Props) {
  return (
    <div className="score-screen">
      <p className="score-final" data-testid="final-score">
        Score: {score}
      </p>
      <button type="button" autoFocus onClick={onAgain}>
        Try again
      </button>{' '}
      <button type="button" onClick={onSettings}>
        Change settings
      </button>
    </div>
  );
}
