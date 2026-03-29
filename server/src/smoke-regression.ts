import WebSocket from 'ws';

interface WSMessage {
  type: string;
  data: unknown;
  id: number;
}

class WSClient {
  private ws: WebSocket;
  private messages: WSMessage[] = [];
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.ws = new WebSocket(url);
  }

  async connectAndRegister(name: string, password: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);

      this.ws.on('error', onError);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        this.messages.push(msg);

        if (msg.type === 'reg' && isObject(msg.data) && msg.data.error === false) {
          this.ws.off('error', onError);
          resolve();
        }
      });

      this.ws.on('open', () => {
        this.send('reg', { name, password });
      });
    });
  }

  send(type: string, data: unknown): void {
    this.ws.send(JSON.stringify({ type, data, id: 0 }));
  }

  async waitFor(type: string, timeoutMs: number): Promise<WSMessage> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const found = this.messages.find((message) => message.type === type);
      if (found) {
        return found;
      }

      await sleep(25);
    }

    throw new Error(`Timeout waiting for message type: ${type}`);
  }

  findByType(type: string): WSMessage[] {
    return this.messages.filter((message) => message.type === type);
  }

  close(): void {
    this.ws.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isGameCreatedPayload(value: unknown): value is { gameId: string; code: string } {
  return isObject(value)
    && typeof value.gameId === 'string'
    && typeof value.code === 'string';
}

async function run(): Promise<void> {
  const uniq = Date.now();
  const wsUrl = 'ws://localhost:3000';

  const host = new WSClient(wsUrl);
  const player1 = new WSClient(wsUrl);
  const player2 = new WSClient(wsUrl);
  const latePlayer = new WSClient(wsUrl);

  try {
    await host.connectAndRegister(`Host_${uniq}`, '123');
    await player1.connectAndRegister(`P1_${uniq}`, '123');
    await player2.connectAndRegister(`P2_${uniq}`, '123');
    await latePlayer.connectAndRegister(`Late_${uniq}`, '123');

    const questions = [
      {
        text: '2 + 2 = ?',
        options: ['1', '2', '3', '4'],
        correctIndex: 3,
        timeLimitSec: 3,
      },
    ];

    host.send('create_game', { questions });
    const created = await host.waitFor('game_created', 1500);
    if (!isGameCreatedPayload(created.data)) {
      throw new Error('game_created payload is invalid');
    }

    const gameId = created.data.gameId;
    const code = created.data.code;

    // Negative: non-host cannot start game.
    player1.send('start_game', { gameId });
    const nonHostStartError = await player1.waitFor('error', 1000);
    assert(
      isObject(nonHostStartError.data) && String(nonHostStartError.data.message).includes('Only host'),
      'Expected non-host start_game to fail with host permission error'
    );

    player1.send('join_game', { code });
    player2.send('join_game', { code });
    await player1.waitFor('game_joined', 1200);
    await player2.waitFor('game_joined', 1200);

    host.send('start_game', { gameId });
    await host.waitFor('question', 1200);
    await player1.waitFor('question', 1200);
    await player2.waitFor('question', 1200);

    // Negative: join when game is in progress.
    latePlayer.send('join_game', { code });
    const joinStartedError = await latePlayer.waitFor('error', 1200);
    assert(
      isObject(joinStartedError.data) && String(joinStartedError.data.message).includes('already started'),
      'Expected join_game to fail when game is already in progress'
    );

    // Positive answers + negative duplicate answer.
    player1.send('answer', { gameId, questionIndex: 0, answerIndex: 3 });
    await player1.waitFor('answer_accepted', 1200);

    player1.send('answer', { gameId, questionIndex: 0, answerIndex: 2 });
    const duplicateAnswerError = await player1.waitFor('error', 1200);
    assert(
      isObject(duplicateAnswerError.data) && String(duplicateAnswerError.data.message).includes('already submitted'),
      'Expected duplicate answer to be rejected'
    );

    player2.send('answer', { gameId, questionIndex: 0, answerIndex: 1 });
    await player2.waitFor('answer_accepted', 1200);

    const questionResult = await host.waitFor('question_result', 1500);
    const finished = await host.waitFor('game_finished', 1500);

    assert(isObject(questionResult.data), 'question_result payload is invalid');
    assert(isObject(finished.data), 'game_finished payload is invalid');

    // Negative: answer after game has been finished and cleaned.
    player1.send('answer', { gameId, questionIndex: 0, answerIndex: 3 });
    const postFinishError = await player1.waitFor('error', 1200);
    assert(
      isObject(postFinishError.data) && String(postFinishError.data.message).includes('Game not found'),
      'Expected answer after finish to fail because game is cleaned up'
    );

    // Phase 4 regression: create/join new game without reconnect.
    host.send('create_game', { questions });
    const secondCreated = await host.waitFor('game_created', 1500);
    if (!isGameCreatedPayload(secondCreated.data)) {
      throw new Error('second game_created payload is invalid');
    }

    const secondCode = secondCreated.data.code;
    player1.send('join_game', { code: secondCode });
    await player1.waitFor('game_joined', 1200);

    console.log('SMOKE_REGRESSION: PASS');
  } finally {
    host.close();
    player1.close();
    player2.close();
    latePlayer.close();
    await sleep(100);
  }
}

run().catch((error) => {
  console.error('SMOKE_REGRESSION: FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

