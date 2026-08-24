const MARKER = /:(?:barcode|formula|selected|unselected):/g;

export interface StrippedContent {
  readonly text: string;
  readonly toSourceOffset: (strippedOffset: number) => number;
}

/** Matches run against readable text, while spans retain offsets into the original provider content. */
export function stripContentMarkers(content: string): StrippedContent {
  const shifts: Array<{ at: number; delta: number }> = [];
  let text = "";
  let sourceOffset = 0;
  let strippedOffset = 0;

  for (const match of content.matchAll(MARKER)) {
    const markerStart = match.index ?? 0;
    const before = content.slice(sourceOffset, markerStart);
    text += before;
    strippedOffset += before.length;
    sourceOffset = markerStart + match[0].length;
    shifts.push({ at: strippedOffset, delta: sourceOffset - strippedOffset });
  }
  text += content.slice(sourceOffset);

  return {
    text,
    toSourceOffset(offset) {
      let delta = 0;
      for (const shift of shifts) {
        if (shift.at > offset) break;
        delta = shift.delta;
      }
      return offset + delta;
    },
  };
}
