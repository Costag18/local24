/**
 * Ideas for the print shop that need no network: what is coming up on the
 * calendar (and how early to list for it), print-shop staples that keep
 * selling, and two small judgements used by the live feeds. Pure, so the
 * dashboard and the server share it.
 */

export interface Occasion {
  name: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Days before the date that listings should be up: people order ahead. */
  leadDays: number;
  ideas: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The nth given weekday (0 = Sunday) of a month, 1-based month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = new Date(y, m - 1, 1).getDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return ymd(y, m, day);
}

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** The year's occasions worth printing for, in Canada. */
export function occasionsFor(y: number): Occasion[] {
  const blackFriday = (() => {
    const thanksgivingUS = nthWeekday(y, 11, 4, 4);
    const [yy, mm, dd] = thanksgivingUS.split("-").map(Number);
    return ymd(yy, mm, dd + 1);
  })();
  return [
    { name: "Valentine's Day", date: ymd(y, 2, 14), leadDays: 21, ideas: ["Lithophane photo hearts", "Custom name roses", "Couple figurines", "Heart jewellery boxes"] },
    { name: "St. Patrick's Day", date: ymd(y, 3, 17), leadDays: 14, ideas: ["Shamrock keychains", "Pint glass toppers", "Leprechaun planters"] },
    { name: "Easter", date: easter(y), leadDays: 21, ideas: ["Egg cups and stands", "Bunny planters", "Fillable eggs", "Name baskets tags"] },
    { name: "Mother's Day", date: nthWeekday(y, 5, 0, 2), leadDays: 21, ideas: ["Lithophane lamps", "Custom planters", "Name jewellery dishes", "Painted flower vases"] },
    { name: "Wedding season", date: ymd(y, 6, 1), leadDays: 60, ideas: ["Custom cake toppers", "Table numbers", "Name place cards", "Ring boxes"] },
    { name: "Graduation", date: ymd(y, 6, 20), leadDays: 21, ideas: ["Grad cap toppers", "Name year signs", "Diploma holders", "Photo frames"] },
    { name: "Father's Day", date: nthWeekday(y, 6, 0, 3), leadDays: 21, ideas: ["Desk organizers", "Custom car keychains", "Tool holders", "Gaming controller stands"] },
    { name: "Canada Day", date: ymd(y, 7, 1), leadDays: 14, ideas: ["Maple leaf decor", "Flag stands", "Cottage signs"] },
    { name: "Back to school", date: ymd(y, 9, 1), leadDays: 28, ideas: ["Name tags for bags", "Desk organizers", "Pencil holders", "Locker accessories"] },
    { name: "Thanksgiving", date: nthWeekday(y, 10, 1, 2), leadDays: 14, ideas: ["Place-card turkeys", "Harvest centrepieces", "Napkin rings"] },
    { name: "Halloween", date: ymd(y, 10, 31), leadDays: 28, ideas: ["Skull candy bowls", "Articulated skeletons", "Jack-o'-lantern lamps", "Cosplay masks and props"] },
    { name: "Black Friday", date: blackFriday, leadDays: 21, ideas: ["Bundle deals on best sellers", "Gift-ready packaging", "Stocking stuffers under $15"] },
    { name: "Christmas", date: ymd(y, 12, 25), leadDays: 42, ideas: ["Custom name ornaments", "Painted figurine gifts", "Lithophane ornaments", "Advent calendars", "Stocking stuffers"] },
  ];
}

/** Whole days from today to a local YYYY-MM-DD date. */
function daysTo(date: string, now: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

export interface UpcomingOccasion extends Occasion {
  daysAway: number;
  /** Days until listings should be up; negative means already late. */
  listInDays: number;
}

/** What is coming within `withinDays`, soonest first, with when to list. */
export function upcomingOccasions(now: number, withinDays = 75): UpcomingOccasion[] {
  const y = new Date(now).getFullYear();
  return [...occasionsFor(y), ...occasionsFor(y + 1)]
    .map((o) => ({ ...o, daysAway: daysTo(o.date, now), listInDays: daysTo(o.date, now) - o.leadDays }))
    .filter((o) => o.daysAway >= 0 && o.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway);
}

/**
 * Staples that keep selling for a print-and-paint shop. Each comes with the
 * search that finds models for it, and why it sells.
 */
export const EVERGREEN: { title: string; why: string; search: string }[] = [
  { title: "Custom name signs", why: "Personal, fast to print, easy upsell to painted", search: "name sign" },
  { title: "Painted figurines & busts", why: "Painting is the premium nobody else offers", search: "bust" },
  { title: "Articulated / flexi animals", why: "Impulse buy; dragons and axolotls sell year-round", search: "articulated dragon" },
  { title: "Lithophanes", why: "Their photo, printed: gifts for every occasion", search: "lithophane" },
  { title: "Cosplay helmets & props", why: "High ticket; finish and paint add the value", search: "cosplay helmet" },
  { title: "Car interior parts", why: "Gauge pods and clips sell steadily on eBay", search: "gauge pod" },
  { title: "Replacement parts & knobs", why: "People pay to fix things that are discontinued", search: "replacement knob" },
  { title: "Tabletop minis & terrain", why: "Gamers buy in sets; painted minis sell high", search: "terrain" },
  { title: "Planters", why: "Steady decor seller; self-watering ones command more", search: "self watering planter" },
  { title: "Desk & cable organizers", why: "Functional, repeat customers, low failure rate", search: "desk organizer" },
  { title: "Controller & headphone stands", why: "Gamer gifts; easy to customize with names", search: "controller stand" },
  { title: "Wedding cake toppers", why: "Custom names and dates; customers order months ahead", search: "cake topper" },
];

/** Whether a model's licence allows selling prints of it. */
export function sellableLicense(license: string): boolean {
  if (!license) return false;
  if (/noncommercial|\bNC\b|-NC/i.test(license)) return false;
  // Printables' own "Standard Digital File License" is personal use only.
  if (/standard digital file/i.test(license)) return false;
  return /CC0|public domain|CC-BY|attribution|GPL|MIT|BSD/i.test(license);
}

/** Where a print request comes from, from its title's tag: Toronto, Ontario, Canada or elsewhere. */
export function requestPlace(title: string): "toronto" | "ontario" | "canada" | "elsewhere" {
  if (/toronto|\bgta\b|mississauga|scarborough|north york|etobicoke|markham|vaughan|brampton/i.test(title)) return "toronto";
  if (/\bCA[- /]?ON\b|ontario|\bON\b[\]\s,]/.test(title)) return "ontario";
  if (/\[\s*(CA|Canada)\b|\bCanada\b|\bCA[- /][A-Z]{2}\b/i.test(title) && !/\bUS[- /]?CA\b/i.test(title)) return "canada";
  return "elsewhere";
}

/**
 * A small Printables thumbnail for an image path. The originals are full
 * camera photos (3 MB is common); the CDN serves a 320x240 WebP of each, about
 * 4 KB, at thumbs/cover/320x240/<original format>/<name>.webp.
 */
export function printablesThumb(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const m = /^(.*)\/([^/]+)\.([a-z0-9]+)$/i.exec(filePath);
  if (!m) return `https://media.printables.com/${filePath}`;
  const fmt = m[3].toLowerCase() === "jpeg" ? "jpg" : m[3].toLowerCase();
  return `https://media.printables.com/${m[1]}/thumbs/cover/320x240/${fmt}/${m[2]}.webp`;
}
