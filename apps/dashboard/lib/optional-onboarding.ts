/** Finish after essentials; persist an explicit deferred sending choice first. */
export async function finishOptionalOnboarding(
  projectId: string,
  options: {
    deferSending: boolean;
    saveDeferred: (projectId: string) => Promise<unknown>;
    complete: () => Promise<unknown>;
    openDashboard: (projectId: string) => void;
  }
): Promise<void> {
  if (options.deferSending) await options.saveDeferred(projectId);
  await options.complete();
  options.openDashboard(projectId);
}
