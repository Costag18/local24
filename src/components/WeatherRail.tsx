"use client";

import { ago, aqiLabel, compactTime, daysUntil, nextWetDay, pickupDay, rainChance, rainStartsInMinutes, temp } from "@/lib/format";
import type { Pickup, Weather } from "@/lib/types";

interface Props {
  weather: Weather | null;
  at: number;
  now: number;
  /** The next garbage collection, if the schedule has loaded. */
  pickup?: Pickup | null;
}

/** Weekdays abbreviate cleanly; "Tonight" does not, so it gets its own short form. */
function dayLabel(day: string): string {
  return /^tonight$/i.test(day) ? "TNGT" : day.slice(0, 3).toUpperCase();
}

/**
 * Current conditions, the next few days, rain/air/sun, and the hours ahead.
 *
 * The four blocks are grid areas, and the window's proportions pick the
 * arrangement (the `wx-` rules in globals.css):
 *
 *   - normal:     now beside the day columns, then the stats row, then hours
 *   - tall, slim: everything stacked, the days turn into rows, hours wrap
 *                 onto two lines, and more days are shown since there is room
 *   - wide strip: all four side by side in a single band
 *
 * Every size is a container query against both axes, so type grows until
 * whichever dimension is scarce runs out instead of floating in dead space.
 */
export function WeatherRail({ weather, at, now, pickup }: Props) {
  const rain = weather ? rainStartsInMinutes(weather.nowcast, now) : null;
  const aq = aqiLabel(weather?.aqi ?? null);
  const wet = weather ? nextWetDay(weather.daily) : null;

  return (
    <section className="panel wx flex flex-col" style={{ minHeight: 0 }}>
      <div className="slab">
        <span className="label label-accent slab-name">Weather</span>
        <span className="label truncate">{weather?.place ?? "—"}</span>
        <span className="flex-1" />
        <span className="label" style={{ color: "var(--ink-faint)" }}>{ago(at, now)}</span>
      </div>

      {!weather ? (
        <div className="py-6 grid place-items-center label">Waiting for first fetch…</div>
      ) : (
        <div className="wx-body">
          <div className="wx-now">
            {weather.iconUrl && (
              // Federal icon host; a plain img degrades quietly if it 404s.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={weather.iconUrl} alt="" className="wx-icon" style={{ opacity: 0.9 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="num wx-temp">{temp(weather.tempC)}</div>
              <div className="label wx-cond wrap2">{weather.condition || "—"}</div>
              <div className="label wx-cond truncate" style={{ color: "var(--ink-faint)" }}>
                {weather.windDir ?? ""} {weather.windKph ?? "--"}km/h · {weather.humidity ?? "--"}%
              </div>
            </div>
          </div>

          {/* Columns when wide, rows when tall. Six are rendered; the
              stylesheet shows as many as the shape has room for. */}
          <div className="wx-days">
            {weather.daily.slice(0, 6).map((d) => {
              const chance = rainChance(d);
              return (
                <div key={d.day} className="wx-day" title={d.condition}>
                  <span className="label wx-dayname" style={{ color: "var(--ink-dim)" }}>
                    {dayLabel(d.day)}
                  </span>
                  <span className="num wx-hi font-bold">{temp(d.hiC)}</span>
                  <span className="num wx-lo" style={{ color: "var(--ink-faint)" }}>{temp(d.loC)}</span>
                  {/* Always present, so the row layout keeps its columns. */}
                  <span className="label wx-pop" style={{ color: "var(--cool)" }}>
                    {chance === null ? "" : `${chance}%`}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="wx-stats">
            <div className="wx-cell">
              <div className="label wx-caption">Rain</div>
              {rain !== null ? (
                <div className="wx-value font-bold" style={{ color: "var(--cool)" }}>
                  {rain === 0 ? "Now" : `${rain}m`}
                </div>
              ) : wet ? (
                // Nothing imminent, so look ahead — this is the question people
                // actually have when they glance at a forecast.
                <div className="wx-value font-bold truncate" style={{ color: "var(--cool)" }}>
                  {dayLabel(wet.day)} {wet.chance}%
                </div>
              ) : (
                <div className="wx-value font-bold">Dry</div>
              )}
            </div>
            <div className="wx-cell">
              <div className="label wx-caption">Air</div>
              <div
                className="wx-value font-bold truncate"
                style={{ color: aq.tone === "ok" ? "var(--ok)" : aq.tone === "warn" ? "var(--warn)" : "var(--accent)" }}
              >
                {aq.text}
              </div>
              {/* UV only matters in daylight and from 3 up, so it is absent otherwise. */}
              {weather.uv != null && weather.uv >= 3 && (
                <div className="label wx-caption" style={{ color: weather.uv >= 6 ? "var(--warn)" : "var(--ink-dim)" }}>
                  UV {Math.round(weather.uv)}
                </div>
              )}
            </div>
            <div className="wx-cell">
              <div className="label wx-caption">Sun</div>
              <div className="num wx-value font-bold">
                <span className="wx-sun">
                  <span><span className="wx-sun-mark">↑</span>{weather.sunrise ? compactTime(weather.sunrise) : "--"}</span>
                  <span><span className="wx-sun-mark">↓</span>{weather.sunset ? compactTime(weather.sunset) : "--"}</span>
                </span>
              </div>
            </div>
            {pickup && (
              <div className="wx-cell" title={`${pickupDay(pickup.date, now)}: ${pickup.items.join(", ")}`}>
                <div className="label wx-caption">Bins</div>
                <div
                  className="wx-value font-bold truncate"
                  style={{ color: daysUntil(pickup.date, now) <= 1 ? "var(--warn)" : undefined }}
                >
                  {pickupDay(pickup.date, now).slice(0, 3)}
                </div>
                {/* Which week it is is the whole question: garbage or recycling. */}
                <div className="label wx-caption wx-wrap" style={{ color: "var(--ink-faint)" }}>
                  {pickup.items.filter((i) => i !== "Green Bin").join(" · ") || "Green Bin"}
                </div>
              </div>
            )}
          </div>

          {weather.hourly.length > 0 && (
            <div className="wx-hours">
              {weather.hourly.slice(0, 8).map((h) => (
                <div key={h.at} className="wx-hour">
                  <span className="label wx-hourtime truncate">{compactTime(h.at)}</span>
                  <span className="num wx-hourtemp font-bold">{temp(h.tempC)}</span>
                </div>
              ))}
            </div>
          )}

          {weather.warnings.length > 0 && (
            <div className="wx-alert" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              <div className="label wx-caption" style={{ color: "inherit" }}>Alert</div>
              <div className="wx-value font-bold wrap2">{weather.warnings[0].title}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
