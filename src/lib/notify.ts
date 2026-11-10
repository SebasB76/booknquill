const EVENT = "bnq-notify";

/** Shows a short message in the app toast; `null` hides it. */
export function notify(message: string | null) {
  window.dispatchEvent(new CustomEvent<string | null>(EVENT, { detail: message }));
}

export function onNotify(cb: (message: string | null) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent<string | null>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
