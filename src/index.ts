import type { Context } from '@deepseek-ai/cordis'

export const name = 'browser-verify'
export const inject = ['tools']

export function apply(ctx: Context): void {
  // Tools are registered in Task 7.
  void ctx
}
