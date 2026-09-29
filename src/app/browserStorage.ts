/** localStorage, or null when the browser refuses access, as some private modes do. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
