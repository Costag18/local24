/**
 * Which TTC alerts belong on the "next buses" board. Pure, client-safe.
 */

/** A live TTC alert, as the board needs it. */
export interface RouteAlert {
  route: string;
  title: string;
  planned: boolean;
}

/**
 * Whether an alert is about this bus route's service. Station notices list
 * every route that stops there ("Escalator out of service at Coxwell" names
 * the 70 and a dozen others), and those say nothing about when the bus comes.
 */
export function affectsRoute(a: RouteAlert, route: string): boolean {
  const routes = a.route.split(/[,\s]+/).filter(Boolean);
  if (!routes.includes(route)) return false;
  if (routes.length > 3) return false;
  return !/escalator|elevator|washroom|entrance|accessib|stairs?\b|fare gate|platform/i.test(a.title);
}

/** "DETOUR", "DELAY"… the one word that says what kind of trouble. */
export function alertWord(title: string): string {
  if (/detour/i.test(title)) return "DETOUR";
  if (/delay|slower|reduced/i.test(title)) return "DELAY";
  if (/no service|suspend|closed|closure/i.test(title)) return "NO SERVICE";
  return "ALERT";
}

