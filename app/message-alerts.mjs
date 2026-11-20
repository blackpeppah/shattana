/**
 * @param {Map<string, bigint> | undefined} previous
 * @param {{ id: string, unreadIncomingId?: string | null }[]} matches
 * @param {boolean} browsingDiscover
 */
export function trackIncomingMessages(previous, matches, browsingDiscover) {
  const seen = previous ?? new Map();
  /** @type {{ chatId: string, messageId: string } | undefined} */
  let alert;
  for (const match of matches) {
    if (!match.unreadIncomingId) continue;
    const id = BigInt(match.unreadIncomingId);
    if (id <= (seen.get(match.id) ?? BigInt(0))) continue;
    seen.set(match.id, id);
    if (previous && browsingDiscover && (!alert || id > BigInt(alert.messageId))) {
      alert = { chatId: match.id, messageId: match.unreadIncomingId };
    }
  }
  return { seen, alert };
}
