import type { RawData, WebSocket } from 'ws';
import type { Game, User, WSMessage } from './types';
import type { ServerState } from './serverState';
import { isRecord } from './validators';

const OPEN_SOCKET_STATE = 1;

export function parseIncomingMessage(raw: RawData): WSMessage | null {
  const text = rawDataToString(raw);

  try {
    const parsed: unknown = JSON.parse(text);

    if (!isRecord(parsed)) {
      return null;
    }

    const type = parsed.type;
    const data = parsed.data;
    const id = parsed.id;

    if (typeof type !== 'string') {
      return null;
    }

    if (typeof id !== 'number') {
      return null;
    }

    return {
      type,
      data,
      id,
    };
  } catch {
    return null;
  }
}

export function sendMessage(ws: WebSocket, type: string, data: unknown, id = 0): void {
  const payload: WSMessage = { type, data, id };

  if (ws.readyState === OPEN_SOCKET_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

export function sendError(ws: WebSocket, message: string): void {
  sendMessage(ws, 'error', { message });
}

export function sendReg(ws: WebSocket, name: string, index: string, error: boolean, errorText: string): void {
  sendMessage(ws, 'reg', {
    name,
    index,
    error,
    errorText,
  });
}

export function broadcastToGame(state: ServerState, game: Game, type: string, data: unknown): void {
  for (const player of game.players) {
    const user = state.usersById.get(String(player.index));
    if (!user?.ws) {
      continue;
    }

    sendMessage(user.ws, type, data);
  }
}

export function broadcastPlayers(state: ServerState, game: Game): void {
  const playersPayload = game.players.map((player) => ({
    name: player.name,
    index: player.index,
    score: player.score,
  }));

  broadcastToGame(state, game, 'update_players', playersPayload);
}

export function getAuthorizedUser(state: ServerState, ws: WebSocket): User | null {
  const userId = state.userIdByWs.get(ws);
  if (!userId) {
    sendError(ws, 'Please register first.');
    return null;
  }

  const user = state.usersById.get(userId);
  if (!user) {
    sendError(ws, 'User session is invalid.');
    return null;
  }

  return user;
}

function rawDataToString(raw: RawData): string {
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf-8');
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf-8');
  }

  return Buffer.from(raw).toString('utf-8');
}

