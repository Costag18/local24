/**
 * Pulls the items out of a large `{"key":[{…},{…}]}` document as the text
 * arrives — the City's event export and its street centreline are both built
 * that way, and both are far too big to hold in memory whole.
 *
 * Tracks string and escape state so braces inside descriptions do not count,
 * and hands back each complete item as its own string for `JSON.parse`.
 * Pure, so it can be tested on a few bytes.
 */
export class ObjectSplitter {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private current: string[] = [];
  private start = -1;

  push(chunk: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === "\\") this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') {
        this.inString = true;
      } else if (c === "{" || c === "[") {
        this.depth++;
        // Root object is depth 1, the array 2, each item 3. A nested object
        // elsewhere at depth 3 (GeoJSON's `crs`) comes through too; callers
        // simply find nothing useful in it.
        if (this.depth === 3 && c === "{") this.start = i;
      } else if (c === "}" || c === "]") {
        if (this.depth === 3 && c === "}" && this.start !== -1) {
          this.current.push(chunk.slice(this.start, i + 1));
          out.push(this.current.join(""));
          this.current = [];
          this.start = -1;
        }
        this.depth--;
      }
    }
    // An item split across chunks: keep what has arrived so far.
    if (this.start !== -1) {
      this.current.push(chunk.slice(this.start));
      this.start = 0;
    }
    return out;
  }
}
