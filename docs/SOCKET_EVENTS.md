# Socket Event Contract

This document is the canonical reference for client/server Socket.IO events.

## Client -> Server

- `createRoom` `{ name, preferredColor?, isPrivate?, disabledMutators?, manualCoinFlip?, browserId? }`
- `joinRoom` `{ name, roomCode, browserId? }`
- `joinBot` `{ name, disabledMutators?, manualCoinFlip?, browserId? }`
- `listRooms` `{}`
- `joinLobby` `{}`
- `spectateRoom` `{ roomCode }`
- `disableSpectating` `{}`
- `move` `{ from, to, promotion? }`
- `resign` `{}`
- `quietResign` `{}`
- `resumeSession` `{ token }`
- mutator flow:
  - `selectMutator` `{ ruleId }`
  - `mutatorActionResponse` `{ ruleId, target, secondTarget?, manualResolve? }`
  - `rpsChoice` `{ choice }`
  - `coinFlipChoice` `{ result }`
  - `coinFlipStart` `{}`
  - `riskItRookFlipChoice` `{ choice }`

## Server -> Client

- connection:
  - `joinSuccess`, `joinError`, `resumeSuccess`, `resumeRejected`
- room/lobby:
  - `roomsList`, `scoreboardUpdate`
- game lifecycle:
  - `gameStarted`, `moveApplied`, `moveRejected`, `gameEnded`
  - `opponentDisconnected`, `opponentReconnected`
- spectator:
  - `spectateSuccess`, `spectateError`, `spectateKicked`, `spectatorCount`
- clock/stalling:
  - `turnClockUpdate`, `quietResignAvailable`, `quietResignRevoked`
- mutator:
  - `mutatorChoice`, `mutatorSelected`, `mutatorChosen`, `mutatorAction`
  - `mutatorActivated`, `mutatorExpired`, `mutatorBoardUpdate`
  - `rpsPrompt`, `rpsResult`
  - `coinFlip`, `coinFlipPrompt`, `coinFlipResult`, `coinFlipStart`
  - `riskItRookFlipPrompt`, `riskItRookFlipResult`
- throttling:
  - `rateLimited` `{ retryAfterMs, event? }`

## Notes

- Keep this file updated whenever adding/removing socket events.
- Prefer backward-compatible payload changes (`newField?`) over required field changes.
