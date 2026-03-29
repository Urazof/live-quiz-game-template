import type { AnswerData, CreateGameData, JoinGameData, Question, RegData, StartGameData } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isRegData(value: unknown): value is RegData {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.name === 'string' && typeof value.password === 'string';
}

export function isCreateGameData(value: unknown): value is CreateGameData {
  if (!isRecord(value)) {
    return false;
  }

  return Array.isArray(value.questions);
}

export function isJoinGameData(value: unknown): value is JoinGameData {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.code === 'string';
}

export function isStartGameData(value: unknown): value is StartGameData {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.gameId === 'string';
}

export function isAnswerData(value: unknown): value is AnswerData {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.gameId === 'string'
    && typeof value.questionIndex === 'number'
    && Number.isInteger(value.questionIndex)
    && typeof value.answerIndex === 'number'
    && Number.isInteger(value.answerIndex);
}

export function validateQuestions(questions: unknown[]): { ok: true; questions: Question[] } | { ok: false; errorMessage: string } {
  if (questions.length === 0) {
    return { ok: false, errorMessage: 'Quiz must contain at least one question.' };
  }

  const validated: Question[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const candidate = questions[i];

    if (!isRecord(candidate)) {
      return { ok: false, errorMessage: `Question ${i + 1}: invalid object.` };
    }

    const text = candidate.text;
    const options = candidate.options;
    const correctIndex = candidate.correctIndex;
    const timeLimitSec = candidate.timeLimitSec;

    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, errorMessage: `Question ${i + 1}: text is required.` };
    }

    if (!Array.isArray(options) || options.length !== 4 || !options.every((option) => typeof option === 'string' && option.trim().length > 0)) {
      return { ok: false, errorMessage: `Question ${i + 1}: exactly 4 non-empty options are required.` };
    }

    if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      return { ok: false, errorMessage: `Question ${i + 1}: correctIndex must be an integer from 0 to 3.` };
    }

    if (typeof timeLimitSec !== 'number' || !Number.isFinite(timeLimitSec) || timeLimitSec <= 0) {
      return { ok: false, errorMessage: `Question ${i + 1}: timeLimitSec must be > 0.` };
    }

    validated.push({
      text: text.trim(),
      options: options.map((option) => option.trim()),
      correctIndex,
      timeLimitSec,
    });
  }

  return { ok: true, questions: validated };
}
