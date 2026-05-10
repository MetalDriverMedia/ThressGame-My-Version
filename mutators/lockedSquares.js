function clearStaleLockedSquares(room) {
  const lockedSquares = room?.mutatorState?.boardModifiers?.lockedSquares;
  if (!Array.isArray(lockedSquares) || lockedSquares.length === 0) return;

  room.mutatorState.boardModifiers.lockedSquares = lockedSquares.filter((entry) => {
    if (!entry || typeof entry.square !== 'string') return false;
    const piece = room.chess.get(entry.square);
    if (!piece) return false;

    if (entry.piece && piece.type !== entry.piece) return false;
    if (entry.color && piece.color !== entry.color) return false;

    return true;
  });
}

module.exports = {
  clearStaleLockedSquares,
};
