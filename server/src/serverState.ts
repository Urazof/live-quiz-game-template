import type { WebSocket } from 'ws';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants';
import type { Game, User } from './types';

export interface ServerState {
  usersByName: Map<string, User>;
  usersById: Map<string, User>;
  gamesById: Map<string, Game>;
  gameIdByCode: Map<string, string>;
  gameIdByUserId: Map<string, string>;
  userIdByWs: WeakMap<WebSocket, string>;
  userSeq: number;
  gameSeq: number;
}

export function createServerState(): ServerState {
  return {
    usersByName: new Map<string, User>(),
    usersById: new Map<string, User>(),
    gamesById: new Map<string, Game>(),
    gameIdByCode: new Map<string, string>(),
    gameIdByUserId: new Map<string, string>(),
    userIdByWs: new WeakMap<WebSocket, string>(),
    userSeq: 0,
    gameSeq: 0,
  };
}

export function createUserId(state: ServerState): string {
  state.userSeq += 1;
  return `u_${state.userSeq}`;
}

export function createGameId(state: ServerState): string {
  state.gameSeq += 1;
  return `g_${state.gameSeq}`;
}

export function generateRoomCode(state: Pick<ServerState, 'gameIdByCode'>): string {
  let code = '';

  do {
    code = '';

    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      const idx = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      code += ROOM_CODE_ALPHABET[idx];
    }
  } while (state.gameIdByCode.has(code));

  return code;
}

export function clearQuestionTimer(game: Game): void {
  if (game.questionTimer) {
    clearTimeout(game.questionTimer);
    game.questionTimer = undefined;
  }
}

export function cleanupGame(state: ServerState, game: Game): void {
  clearQuestionTimer(game);

  for (const player of game.players) {
    state.gameIdByUserId.delete(String(player.index));
  }

  state.gameIdByCode.delete(game.code);
  state.gamesById.delete(game.id);
}

