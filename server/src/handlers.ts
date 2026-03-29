import type { WebSocket } from 'ws';
import { BASE_POINTS, ROUND_RESULT_DELAY_MS } from './constants';
import { broadcastPlayers, broadcastToGame, getAuthorizedUser, sendError, sendMessage, sendReg } from './protocol';
import { cleanupGame, clearQuestionTimer, createGameId, createUserId, generateRoomCode, type ServerState } from './serverState';
import { isAnswerData, isCreateGameData, isJoinGameData, isRegData, isStartGameData, validateQuestions } from './validators';
import type { Game, Player, User } from './types';

export function handleReg(state: ServerState, ws: WebSocket, payload: unknown): void {
  if (!isRegData(payload)) {
    sendReg(ws, '', '', true, 'Invalid reg payload.');
    return;
  }

  const name = payload.name.trim();
  const password = payload.password.trim();

  if (!name || !password) {
    sendReg(ws, name, '', true, 'Name and password are required.');
    return;
  }

  const existingUser = state.usersByName.get(name);

  if (!existingUser) {
    const index = createUserId(state);
    const newUser: User = {
      name,
      password,
      index,
      ws,
    };

    state.usersByName.set(name, newUser);
    state.usersById.set(index, newUser);
    state.userIdByWs.set(ws, index);

    sendReg(ws, name, index, false, '');
    return;
  }

  if (existingUser.password !== password) {
    sendReg(ws, name, existingUser.index, true, 'Wrong password.');
    return;
  }

  existingUser.ws = ws;
  state.userIdByWs.set(ws, existingUser.index);
  sendReg(ws, existingUser.name, existingUser.index, false, '');
}

export function handleCreateGame(state: ServerState, ws: WebSocket, payload: unknown): void {
  const user = getAuthorizedUser(state, ws);
  if (!user) {
    return;
  }

  if (!isCreateGameData(payload)) {
    sendError(ws, 'Invalid create_game payload.');
    return;
  }

  const validatedQuestions = validateQuestions(payload.questions);
  if (!validatedQuestions.ok) {
    sendError(ws, validatedQuestions.errorMessage);
    return;
  }

  if (state.gameIdByUserId.has(user.index)) {
    sendError(ws, 'User is already in a game.');
    return;
  }

  const gameId = createGameId(state);
  const code = generateRoomCode(state);

  const hostPlayer: Player = {
    name: user.name,
    index: user.index,
    score: 0,
  };

  const game: Game = {
    id: gameId,
    code,
    hostId: user.index,
    questions: validatedQuestions.questions,
    players: [hostPlayer],
    currentQuestion: -1,
    status: 'waiting',
    playerAnswers: new Map(),
  };

  state.gamesById.set(gameId, game);
  state.gameIdByCode.set(code, gameId);
  state.gameIdByUserId.set(user.index, gameId);

  sendMessage(ws, 'game_created', { gameId, code });
  broadcastPlayers(state, game);
}

export function handleJoinGame(state: ServerState, ws: WebSocket, payload: unknown): void {
  const user = getAuthorizedUser(state, ws);
  if (!user) {
    return;
  }

  if (!isJoinGameData(payload)) {
    sendError(ws, 'Invalid join_game payload.');
    return;
  }

  const code = payload.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    sendError(ws, 'Room code must be 6 alphanumeric characters.');
    return;
  }

  if (state.gameIdByUserId.has(user.index)) {
    sendError(ws, 'User is already in a game.');
    return;
  }

  const gameId = state.gameIdByCode.get(code);
  if (!gameId) {
    sendError(ws, 'Game not found for this code.');
    return;
  }

  const game = state.gamesById.get(gameId);
  if (!game) {
    sendError(ws, 'Game not found.');
    return;
  }

  if (game.status !== 'waiting') {
    sendError(ws, 'Game has already started.');
    return;
  }

  const alreadyInList = game.players.some((player) => String(player.index) === user.index);
  if (!alreadyInList) {
    game.players.push({
      name: user.name,
      index: user.index,
      score: 0,
    });
  }

  state.gameIdByUserId.set(user.index, game.id);

  sendMessage(ws, 'game_joined', { gameId: game.id });
  broadcastToGame(state, game, 'player_joined', {
    playerName: user.name,
    playerCount: game.players.length,
  });
  broadcastPlayers(state, game);
}

export function handleStartGame(state: ServerState, ws: WebSocket, payload: unknown): void {
  const user = getAuthorizedUser(state, ws);
  if (!user) {
    return;
  }

  if (!isStartGameData(payload)) {
    sendError(ws, 'Invalid start_game payload.');
    return;
  }

  const game = state.gamesById.get(payload.gameId);
  if (!game) {
    sendError(ws, 'Game not found.');
    return;
  }

  if (String(game.hostId) !== user.index) {
    sendError(ws, 'Only host can start the game.');
    return;
  }

  if (game.status !== 'waiting') {
    sendError(ws, 'Game is already started or finished.');
    return;
  }

  if (game.questions.length === 0) {
    sendError(ws, 'Game has no questions.');
    return;
  }

  game.status = 'in_progress';
  game.currentQuestion = 0;
  startQuestion(state, game);
}

export function handleDisconnect(state: ServerState, ws: WebSocket): void {
  const userId = state.userIdByWs.get(ws);
  if (!userId) {
    return;
  }

  const user = state.usersById.get(userId);
  if (user?.ws === ws) {
    user.ws = undefined;
  }

  const gameId = state.gameIdByUserId.get(userId);
  if (!gameId) {
    return;
  }

  const game = state.gamesById.get(gameId);
  if (!game) {
    state.gameIdByUserId.delete(userId);
    return;
  }

  if (String(game.hostId) === userId) {
    broadcastToGame(state, game, 'error', { message: 'Host disconnected. Game was closed.' });
    cleanupGame(state, game);
    return;
  }

  game.players = game.players.filter((player) => String(player.index) !== userId);
  game.playerAnswers.delete(userId);
  state.gameIdByUserId.delete(userId);

  if (game.players.length === 0) {
    cleanupGame(state, game);
    return;
  }

  broadcastPlayers(state, game);

  if (game.status === 'in_progress' && allActivePlayersAnswered(game)) {
    finalizeCurrentQuestion(state, game.id, 'all_answered');
  }
}

export function handleAnswer(state: ServerState, ws: WebSocket, payload: unknown): void {
  const user = getAuthorizedUser(state, ws);
  if (!user) {
    return;
  }

  if (!isAnswerData(payload)) {
    sendError(ws, 'Invalid answer payload.');
    return;
  }

  const game = state.gamesById.get(payload.gameId);
  if (!game) {
    sendError(ws, 'Game not found.');
    return;
  }

  if (game.status !== 'in_progress') {
    sendError(ws, 'Game is not in progress.');
    return;
  }

  if (payload.questionIndex !== game.currentQuestion) {
    sendError(ws, 'Answer is for a non-active question.');
    return;
  }

  if (payload.answerIndex < 0 || payload.answerIndex > 3) {
    sendError(ws, 'answerIndex must be in range 0..3.');
    return;
  }

  const userId = user.index;
  const isPlayerInGame = game.players.some((player) => String(player.index) === userId);
  if (!isPlayerInGame) {
    sendError(ws, 'User is not a player in this game.');
    return;
  }

  if (String(game.hostId) === userId) {
    sendError(ws, 'Host cannot submit answers.');
    return;
  }

  if (game.playerAnswers.has(userId)) {
    sendError(ws, 'Answer for this question was already submitted.');
    return;
  }

  game.playerAnswers.set(userId, {
    answerIndex: payload.answerIndex,
    timestamp: Date.now(),
  });

  sendMessage(ws, 'answer_accepted', { questionIndex: game.currentQuestion });

  if (allActivePlayersAnswered(game)) {
    finalizeCurrentQuestion(state, game.id, 'all_answered');
  }
}

const finalizingQuestionByGameId = new Set<string>();

function startQuestion(state: ServerState, game: Game): void {
  if (game.status !== 'in_progress') {
    return;
  }

  const question = game.questions[game.currentQuestion];
  if (!question) {
    finishGame(state, game);
    return;
  }

  game.playerAnswers.clear();
  game.questionStartTime = Date.now();
  clearQuestionTimer(game);

  broadcastToGame(state, game, 'question', {
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length,
    text: question.text,
    options: question.options,
    timeLimitSec: question.timeLimitSec,
  });

  game.questionTimer = setTimeout(() => {
    finalizeCurrentQuestion(state, game.id, 'timeout');
  }, question.timeLimitSec * 1000);
}

function finalizeCurrentQuestion(state: ServerState, gameId: string, _reason: 'timeout' | 'all_answered'): void {
  if (finalizingQuestionByGameId.has(gameId)) {
    return;
  }

  finalizingQuestionByGameId.add(gameId);

  const game = state.gamesById.get(gameId);
  if (!game || game.status !== 'in_progress') {
    finalizingQuestionByGameId.delete(gameId);
    return;
  }

  const question = game.questions[game.currentQuestion];
  if (!question) {
    finishGame(state, game);
    finalizingQuestionByGameId.delete(gameId);
    return;
  }

  clearQuestionTimer(game);

  const playerResults = game.players.map((player) => {
    const playerId = String(player.index);
    const answer = game.playerAnswers.get(playerId);
    const answered = Boolean(answer);

    if (!answer) {
      return {
        name: player.name,
        answered: false,
        correct: false,
        pointsEarned: 0,
        totalScore: player.score,
      };
    }

    const correct = answer.answerIndex === question.correctIndex;
    let pointsEarned = 0;

    if (correct && typeof game.questionStartTime === 'number') {
      pointsEarned = calculateSpeedPoints(answer.timestamp, game.questionStartTime, question.timeLimitSec);
      player.score += pointsEarned;
    }

    return {
      name: player.name,
      answered,
      correct,
      pointsEarned,
      totalScore: player.score,
    };
  });

  broadcastToGame(state, game, 'question_result', {
    questionIndex: game.currentQuestion,
    correctIndex: question.correctIndex,
    playerResults,
  });

  if (game.currentQuestion >= game.questions.length - 1) {
    finishGame(state, game);
    finalizingQuestionByGameId.delete(gameId);
    return;
  }

  game.currentQuestion += 1;
  game.questionTimer = setTimeout(() => {
    startQuestion(state, game);
  }, ROUND_RESULT_DELAY_MS);

  finalizingQuestionByGameId.delete(gameId);
}

function finishGame(state: ServerState, game: Game): void {
  game.status = 'finished';
  clearQuestionTimer(game);

  const scoreboard = [...game.players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((player, idx) => ({
      name: player.name,
      score: player.score,
      rank: idx + 1,
    }));

  broadcastToGame(state, game, 'game_finished', { scoreboard });
}

function allActivePlayersAnswered(game: Game): boolean {
  const responderIds = game.players
    .filter((player) => String(player.index) !== String(game.hostId))
    .map((player) => String(player.index));

  if (responderIds.length === 0) {
    return false;
  }

  return responderIds.every((playerId) => game.playerAnswers.has(playerId));
}

function calculateSpeedPoints(answerTimestamp: number, questionStartTime: number, timeLimitSec: number): number {
  const elapsedMs = Math.max(0, answerTimestamp - questionStartTime);
  const timeLimitMs = timeLimitSec * 1000;
  const remainingMs = Math.max(0, timeLimitMs - elapsedMs);
  const rawPoints = BASE_POINTS * (remainingMs / timeLimitMs);

  return Math.floor(Math.max(0, Math.min(BASE_POINTS, rawPoints)));
}
