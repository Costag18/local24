import { describe, expect, it } from "vitest";
import { bestGrid, expandToAspect, listColumns, unwrapHeading } from "../src/lib/shape";

describe("bestGrid", () => {
  it("puts two cameras side by side in a wide window", () => {
    expect(bestGrid(2, 1200, 300)).toEqual({ cols: 2, rows: 1 });
  });

  it("stacks two cameras in a tall window", () => {
    expect(bestGrid(2, 300, 700)).toEqual({ cols: 1, rows: 2 });
  });

  it("makes a square-ish grid for four cameras in a 16:9 window", () => {
    expect(bestGrid(4, 1600, 900)).toEqual({ cols: 2, rows: 2 });
  });

  it("falls back to a stack before the window has a size", () => {
    expect(bestGrid(3, 0, 0)).toEqual({ cols: 1, rows: 3 });
    expect(bestGrid(1, 500, 500)).toEqual({ cols: 1, rows: 1 });
  });
});

describe("listColumns", () => {
  it("keeps one column in a normal or tall window", () => {
    expect(listColumns(500, 400)).toBe(1);
    expect(listColumns(300, 900)).toBe(1);
  });

  it("splits a wide, short window into columns no narrower than the minimum", () => {
    expect(listColumns(700, 250)).toBe(2);
    expect(listColumns(1400, 250)).toBe(3);
  });

  it("never goes past three columns", () => {
    expect(listColumns(4000, 300)).toBe(3);
  });
});

describe("expandToAspect", () => {
  const limit = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

  it("grows a view vertically for a tall window", () => {
    const v = expandToAspect({ x0: 400, y0: 450, x1: 600, y1: 550 }, 0.5, limit);
    expect(v.x1 - v.x0).toBeCloseTo(200);
    expect(v.y1 - v.y0).toBeCloseTo(400);
    expect((v.y0 + v.y1) / 2).toBeCloseTo(500);
  });

  it("slides back inside the data rather than shrinking", () => {
    const v = expandToAspect({ x0: 0, y0: 0, x1: 200, y1: 100 }, 1, limit);
    expect(v).toEqual({ x0: 0, y0: 0, x1: 200, y1: 200 });
  });

  it("shows all of the data when the window wants more than exists", () => {
    const v = expandToAspect({ x0: 400, y0: 0, x1: 600, y1: 1000 }, 4, limit);
    expect(v.x0).toBe(0);
    expect(v.x1).toBe(1000);
  });
});

describe("unwrapHeading", () => {
  it("turns the short way across north", () => {
    expect(unwrapHeading(350, 10)).toBe(370);
    expect(unwrapHeading(10, 350)).toBe(-10);
  });

  it("keeps going from an angle that has already wrapped", () => {
    expect(unwrapHeading(370, 30)).toBe(390);
  });

  it("starts from the reported heading", () => {
    expect(unwrapHeading(undefined, 123)).toBe(123);
  });
});
