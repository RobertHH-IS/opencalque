/**
 * The loading screen of index.html, shown from the first paint while the app's code loads. It
 * stays over the editor until the app knows what to show first (the file it was started with, or
 * the welcome window), so that nothing is drawn on an editor about to be covered. Taken away by
 * `startUp`, or by the app's `Guard` when the interface fails, so that its message can be read.
 */
export function hideSplash(): void {
  const splash = document.getElementById('splash')
  if (!splash || splash.classList.contains('leaving')) return
  // Clicks go through it at once; it is gone once it has faded.
  splash.classList.add('leaving')
  setTimeout(() => splash.remove(), 250)
}
