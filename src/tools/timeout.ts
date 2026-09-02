/** Race a promise against a deadline; the loser's work is abandoned, not awaited. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`browser-verify: ${label} 超时（${ms}ms）。请检查页面或调大 DSH_BROWSER_VERIFY_TIMEOUT 后重试。`)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}
