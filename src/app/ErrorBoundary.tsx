import { Component, type ReactNode } from 'react';

interface Props {
  onBack: () => void;
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Keeps one broken screen from blanking the app (spec 19). It catches errors thrown while a
 * child renders. It does not catch errors in event handlers or in async code. The drill
 * screen stays outside it: the drill does not render through React after mount.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="storage-banner">
        <p>Something went wrong on this screen.</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onBack();
          }}
        >
          Back to settings
        </button>
      </div>
    );
  }
}
