import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { PORT } from './constants';
import { handleCreateGame, handleDisconnect, handleJoinGame, handleReg, handleStartGame } from './handlers';
import { parseIncomingMessage, sendError } from './protocol';
import { createServerState } from './serverState';


const state = createServerState();
const wss = new WebSocketServer({ port: PORT });


console.log(`[quiz-server] WebSocket server started at ws://localhost:${PORT}`);


wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw: RawData) => {
    const message = parseIncomingMessage(raw);


    if (!message) {
      sendError(ws, 'Invalid message format. Expected JSON with { type, data, id }.');
      return;
    }


    const { type, data } = message;


    switch (type) {
      case 'reg':
        handleReg(state, ws, data);
        return;
      case 'create_game':
        handleCreateGame(state, ws, data);
        return;
      case 'join_game':
        handleJoinGame(state, ws, data);
        return;
      case 'start_game':
        handleStartGame(state, ws, data);
        return;
      case 'answer':
        sendError(ws, 'answer will be implemented in Iteration 3.');
        return;
      default:
        sendError(ws, `Unknown command: ${type}`);
    }
  });


  ws.on('close', () => {
    handleDisconnect(state, ws);
  });
});
