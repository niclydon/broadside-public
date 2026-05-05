function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

export function isShowcaseDemoEnabled(): boolean {
  return isTruthy(process.env.BROADSIDE_SHOWCASE_DEMO);
}

export function assertShowcaseDemoEnabled(): void {
  if (!isShowcaseDemoEnabled()) {
    throw new Error(
      'Refusing to start: this public repository is showcase-only. Set BROADSIDE_SHOWCASE_DEMO=true to run a local demo.',
    );
  }
}
