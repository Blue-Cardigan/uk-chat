export function shouldClearPendingMcpToken(params: {
  pendingToken: string | null;
  attemptedTokens: Iterable<string>;
}): boolean {
  const { pendingToken, attemptedTokens } = params;
  if (!pendingToken) return false;
  for (const attempted of attemptedTokens) {
    if (attempted === pendingToken) return true;
  }
  return false;
}
