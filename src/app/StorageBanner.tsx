interface Props {
  state: 'opening' | 'ready' | 'full' | 'unavailable';
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
  return null;
}
