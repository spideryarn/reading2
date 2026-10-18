/** Cheap lexical screen for a labelled outside-the-article sentence. */
const OUTSIDE_MARKER =
  /outside (?:this|the) (?:piece|article)|the (?:article|piece) (?:doesn['’]t|does not) say|doesn['’]t say so, but|from (?:my (?:own )?)?memory|unchecked|unverified|not from the (?:article|piece)|most historians|usually dated|generally dated|most scholars|beyond the (?:article|piece)/i;

export function hasOutsideMarker(text: string): boolean {
  return OUTSIDE_MARKER.test(text);
}
