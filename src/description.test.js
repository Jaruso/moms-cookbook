import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionParagraphs, descriptionEditorText, descriptionPreview } from './description.js';

test('splits descriptions at blank lines and keeps paragraph order', () => {
  assert.deepEqual(descriptionParagraphs('First paragraph.\n\nSecond paragraph.\n  \nThird paragraph.'), [
    'First paragraph.', 'Second paragraph.', 'Third paragraph.',
  ]);
});

test('normalizes single newlines inside a paragraph and Windows line endings', () => {
  assert.deepEqual(descriptionParagraphs('A line\r\ncontinued.\r\n\r\nAnother.'), [
    'A line continued.', 'Another.',
  ]);
});

test('supports legacy strings, ordered arrays, and empty descriptions', () => {
  assert.deepEqual(descriptionParagraphs('A short description.'), ['A short description.']);
  assert.deepEqual(descriptionParagraphs(['First.', 'Second.']), ['First.', 'Second.']);
  assert.deepEqual(descriptionParagraphs(''), []);
  assert.deepEqual(descriptionParagraphs([]), []);
  assert.equal(descriptionEditorText(['First.', 'Second.']), 'First.\n\nSecond.');
  assert.equal(descriptionPreview(['An extended opening paragraph.', 'Another.'], 11), 'An extended…');
});
