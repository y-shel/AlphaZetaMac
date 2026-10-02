interface Props {
  state: 'opening' | 'ready' | 'full' | 'unavailable' | 'blocked';
}

export function StorageBanner({ state }: Props) {
  if (state === 'unavailable') {
    return (
      <p role="status" className="storage-banner">
        This browser is not letting the app store data, so nothing is being saved. The drill still works.
      </p>
    );
  }
  if (state === 'full') {
    return (
      <p role="status" className="storage-banner">
        Storage is full. The last round was not saved, and new rounds will not be either. Export your data to keep what is already saved.
      </p>
    );
  }
  if (state === 'blocked') {
    return (
      <p role="status" className="storage-banner">
        A newer version of the app opened in another tab, so this tab stopped saving. Reload this tab.
      </p>
    );
  }
  return null;
}
