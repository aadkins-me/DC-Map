import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError, LIMITS, RateLimiter, createNote, deleteNote, emptyBoard, isValidBoardId, parseJsonBody, updateNote } from './board.ts';

const valid = { author: 'Sam', text: 'Nice street', lat: 38.91, lng: -77.03 };

test('board ids must be long and URL-safe', () => {
  assert.equal(isValidBoardId('aZ09_-aZ09_-aZ09_-aZ09'), true);
  assert.equal(isValidBoardId('short'), false);
  assert.equal(isValidBoardId('has spaces in it, 1234567890'), false);
  assert.equal(isValidBoardId('../../../../etc/passwd/xxxxxx'), false);
  assert.equal(isValidBoardId(null), false);
});

test('creates a note with cleaned fields', () => {
  const board = emptyBoard();
  const note = createNote(board, { ...valid, text: '  hi\u0007 there\nline two  ' }, 'n1', 1000);
  assert.equal(note.text, 'hi there\nline two');
  assert.equal(note.kind, 'free');
  assert.equal(board.rev, 1);
});

test('rejects bad input', () => {
  const board = emptyBoard();
  const bad = [
    { ...valid, text: '' },
    { ...valid, text: 'x'.repeat(LIMITS.text + 1) },
    { ...valid, author: 'x'.repeat(LIMITS.author + 1) },
    { ...valid, lat: 40.7 },
    { ...valid, lng: 'nope' },
    { ...valid, kind: 'other' },
    { ...valid, kind: 'pin' },
    { ...valid, kind: 'hood', ref: 'Shaw', hoodId: 1.5 },
  ];
  for (const body of bad) assert.throws(() => createNote(board, body, 'n', 0), HttpError, JSON.stringify(body));
  assert.equal(board.notes.length, 0);
});

test('caps notes per board', () => {
  const board = emptyBoard();
  for (let i = 0; i < LIMITS.notesPerBoard; i++) createNote(board, valid, `n${i}`, i);
  assert.throws(() => createNote(board, valid, 'over', 0), (e: HttpError) => e.status === 409);
});

test('updates text and position but not the author', () => {
  const board = emptyBoard();
  createNote(board, { ...valid, kind: 'pin', ref: 'Apt' }, 'n1', 0);
  const n = updateNote(board, 'n1', { text: 'Edited', author: 'Mallory', lat: 38.92, lng: -77.04 }, 5);
  assert.deepEqual([n.text, n.author, n.lat, n.updatedAt], ['Edited', 'Sam', 38.92, 5]);
  assert.throws(() => updateNote(board, 'missing', { text: 'x' }, 0), (e: HttpError) => e.status === 404);
});

test('deletes notes', () => {
  const board = emptyBoard();
  createNote(board, valid, 'n1', 0);
  assert.equal(deleteNote(board, 'n1'), true);
  assert.equal(deleteNote(board, 'n1'), false);
});

test('parses only small JSON objects', () => {
  assert.throws(() => parseJsonBody('x'.repeat(LIMITS.bodyBytes + 1)), (e: HttpError) => e.status === 413);
  assert.throws(() => parseJsonBody('[1]'), HttpError);
  assert.throws(() => parseJsonBody('{oops'), HttpError);
  assert.deepEqual(parseJsonBody('{"a":1}'), { a: 1 });
});

test('rate limiter blocks after the limit within a window', () => {
  const rl = new RateLimiter(2, 1000);
  assert.deepEqual([rl.allow('ip', 0), rl.allow('ip', 1), rl.allow('ip', 2), rl.allow('other', 2), rl.allow('ip', 1001)], [true, true, false, true, true]);
});
