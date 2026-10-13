/**
 * Layout decisions that depend on the shape of a window.
 *
 * Windows can be dragged to any proportion, so a panel cannot assume it is a
 * landscape box. These are pure so the choices can be tested without a DOM;
 * the components measure themselves and ask.
 */

/**
 * The grid of rows and columns that shows `n` pictures largest.
 *
 * Each cell is cropped to fill (object-fit: cover), so the best grid is the
 * one whose cells are closest to the pictures' own proportion — two cameras
 * sit side by side in a wide window and stacked in a tall one. Distance is
 * measured on a log scale, so twice too wide and twice too tall are equally
 * bad. On a tie, fewer empty cells wins.
 */
export function bestGrid(n: number, width: number, height: number, aspect = 16 / 9): { cols: number; rows: number } {
  if (n <= 1 || !(width > 0) || !(height > 0)) return { cols: 1, rows: Math.max(1, n) };
  let best = { cols: 1, rows: n };
  let bestScore = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = width / cols / (height / rows);
    const score = Math.abs(Math.log(cell / aspect)) + (cols * rows - n) * 0.05;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = { cols, rows };
    }
  }
  return best;
}

/**
 * How many columns a list of short text rows should flow into.
 *
 * A single column of headlines in a window three times wider than it is tall
 * leaves most of each row empty and scrolls through the rest; splitting into
 * columns puts more on screen at once. A column never gets narrower than
 * `minCol` pixels, where a headline would wrap onto too many lines.
 */
export function listColumns(width: number, height: number, minCol = 300): number {
  if (!(width > 0) || !(height > 0)) return 1;
  if (width / height < 1.6) return 1;
  return Math.max(1, Math.min(3, Math.floor(width / minCol)));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Grows `view` to the window's proportions, staying inside `limit`.
 *
 * The map used to draw a fixed landscape canvas cropped to the window, which
 * in a tall, slim window threw away nearly everything left and right of
 * centre. Growing the view along the spare axis shows more of the
 * neighbourhood instead — as far as there is data for — and never crops what
 * was asked for.
 */
export function expandToAspect(view: Box, aspect: number, limit: Box): Box {
  const w = view.x1 - view.x0;
  const h = view.y1 - view.y0;
  if (!(w > 0) || !(h > 0) || !(aspect > 0)) return view;

  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  let nw = w;
  let nh = h;
  if (w / h < aspect) nw = h * aspect;
  else nh = w / aspect;

  const fit = (c: number, size: number, lo: number, hi: number): [number, number] => {
    // Wider than the data: show all of the data, centred.
    if (size >= hi - lo) return [lo, hi];
    let a = c - size / 2;
    let b = c + size / 2;
    // Slide back inside rather than shrink, so the window stays full.
    if (a < lo) [a, b] = [lo, lo + size];
    if (b > hi) [a, b] = [hi - size, hi];
    return [a, b];
  };

  const [x0, x1] = fit(cx, nw, Math.min(limit.x0, view.x0), Math.max(limit.x1, view.x1));
  const [y0, y1] = fit(cy, nh, Math.min(limit.y0, view.y0), Math.max(limit.y1, view.y1));
  return { x0, y0, x1, y1 };
}

/**
 * The angle to turn to next, carried on from the previous one so that an
 * animated turn takes the short way round: 350° then 10° becomes 370°, a 20°
 * turn, rather than a 340° spin back the other way.
 */
export function unwrapHeading(prev: number | undefined, next: number): number {
  if (prev === undefined) return next;
  return prev + ((((next - prev) % 360) + 540) % 360) - 180;
}
