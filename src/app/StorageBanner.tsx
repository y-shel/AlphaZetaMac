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
        Storage is full, so new rounds are not being saved. Export your data to keep it.
      </p>
    );
  }
  return null;
}
