import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// The repo has no DOM test setup, so these run without one and without JSX.
describe('ErrorBoundary', () => {
  it('turns a render error into the failed state', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it('renders a child that does not throw as is', () => {
    const html = renderToString(createElement(ErrorBoundary, { onBack: () => undefined, children: createElement('p', null, 'fine') }));
    expect(html).toBe('<p>fine</p>');
  });

  it('in the failed state shows the sentence and the button', () => {
    const boundary = new ErrorBoundary({ onBack: () => undefined, children: createElement('p', null, 'hidden') });
    boundary.state = { failed: true };
    const html = renderToString(boundary.render());
    expect(html).toContain('Something went wrong on this screen.');
    expect(html).toContain('Back to settings');
    expect(html).not.toContain('hidden');
  });

  it('the button clears the error and calls onBack', () => {
    const onBack = vi.fn();
    const boundary = new ErrorBoundary({ onBack, children: null });
    const setState = vi.spyOn(boundary, 'setState').mockImplementation(() => undefined);
    boundary.state = { failed: true };
    const button = (boundary.render() as { props: { children: { props: { onClick: () => void } }[] } }).props.children[1]!;
    button.props.onClick();
    expect(setState).toHaveBeenCalledWith({ failed: false });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
