// Accepts both older single-string descriptions and new ordered paragraph arrays.
export function descriptionParagraphs(value) {
  if (value == null || value === '') return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts.flatMap(part => {
    if (typeof part !== 'string') return [];
    return part.replace(/\r\n?/g, '\n')
      .split(/\n\s*\n+/)
      .map(paragraph => paragraph.replace(/[ \t]*\n[ \t]*/g, ' ').trim())
      .filter(Boolean);
  });
}

export function descriptionEditorText(value) {
  return descriptionParagraphs(value).join('\n\n');
}

export function descriptionPreview(value, maxLength = 160) {
  const first = descriptionParagraphs(value)[0] || '';
  if (first.length <= maxLength) return first;
  const trimmed = first.slice(0, maxLength + 1);
  const boundary = trimmed.lastIndexOf(' ');
  return (boundary > maxLength / 2 ? trimmed.slice(0, boundary) : first.slice(0, maxLength)).trimEnd() + '…';
}
