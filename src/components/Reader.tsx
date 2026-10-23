"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ago } from "@/lib/format";
import { youtubeId, type Article } from "@/lib/reader";

type Loaded = { kind: "article"; article: Article } | { kind: "error"; message: string };

/**
 * Links open here, over the dashboard, instead of in a new tab.
 *
 * In the kiosk window a new tab has no tab strip and no back button, so a
 * clicked headline used to be a dead end. Every outside link on the page is
 * caught on its way out and shown in this overlay: the story's text, or the
 * video for a YouTube link, with the original page one click away.
 *
 * Getting back is deliberately easy: the ← Back button, ✕, Esc, Backspace,
 * clicking outside, or the mouse's back button (the overlay is a history
 * entry, so the browser's own Back closes it).
 */
export function Reader() {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [original, setOriginal] = useState(false);
  const pushed = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  const open = useCallback((next: string) => {
    setUrl(next);
    setOriginal(false);
    setLoaded(null);
    if (!pushed.current) {
      window.history.pushState({ local24Reader: true }, "");
      pushed.current = true;
    }
  }, []);

  const close = useCallback(() => {
    // Unwinding the history entry closes the overlay through `popstate`, so
    // the browser's Back and this button end up in the same place.
    if (pushed.current) window.history.back();
    else setUrl(null);
  }, []);

  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      setUrl(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Catch outside links on the whole page. Ctrl/Shift/middle clicks are left
  // alone, so on a normal desktop you can still open a real tab on purpose.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.dataset.reader === "off") return;
      let target: URL;
      try {
        target = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (target.origin === window.location.origin || !/^https?:$/.test(target.protocol)) return;
      e.preventDefault();
      open(target.toString());
    };
    const onRead = (e: Event) => open((e as CustomEvent<string>).detail);
    document.addEventListener("click", onClick, true);
    window.addEventListener("local24:read", onRead);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("local24:read", onRead);
    };
  }, [open]);

  const video = url ? youtubeId(url) : null;

  useEffect(() => {
    if (!url || video) return;
    let cancelled = false;
    void fetch(`/api/read?url=${encodeURIComponent(url)}`)
      .then(async (r) => {
        const body = (await r.json()) as Article & { error?: string };
        if (cancelled) return;
        setLoaded(body.error ? { kind: "error", message: body.error } : { kind: "article", article: body });
      })
      .catch(() => !cancelled && setLoaded({ kind: "error", message: "Could not reach the dashboard server." }));
    scroller.current?.scrollTo(0, 0);
    return () => {
      cancelled = true;
    };
  }, [url, video]);

  // While open, the dashboard's own shortcuts stand down (arrow keys scroll
  // the story instead of changing the volume), and Esc / Backspace go back.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Backspace" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        close();
      }
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [url, close]);

  if (!url) return null;

  const kiosk = typeof document !== "undefined" && document.documentElement.dataset.kiosk === "1";
  const article = loaded?.kind === "article" ? loaded.article : null;
  const thin = article !== null && article.blocks.length < 3 && !article.links?.length;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* shown blank */
  }

  return (
    <div
      className="reader-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="reader">
        <div className="reader-bar">
          <button onClick={close} className="reader-back" title="Back to LOCAL 24 (Esc)">
            ← Back
          </button>
          <span className="label truncate" style={{ minWidth: 0 }}>{article?.site || host}</span>
          <span className="flex-1" />
          {!video && (
            <button
              onClick={() => setOriginal((o) => !o)}
              className="tag px-2 py-1"
              style={{ border: "1px solid var(--line)", borderRadius: 2, color: "var(--ink-dim)" }}
              title={original ? "Back to the readable text" : "Show the site itself"}
            >
              {original ? "Text view" : "Original page"}
            </button>
          )}
          {/* A real new tab, for a normal browser. In the kiosk it would be
              the same dead end this overlay exists to avoid. */}
          {!kiosk && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              data-reader="off"
              className="tag px-2 py-1"
              style={{ border: "1px solid var(--line)", borderRadius: 2, color: "var(--ink-dim)" }}
              title="Open in a new tab"
            >
              ↗
            </a>
          )}
          <button onClick={close} className="tag px-2 py-1" style={{ color: "var(--ink-dim)" }} title="Close (Esc)">
            ✕
          </button>
        </div>

        {video ? (
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000" }}>
            <iframe
              src={`https://www.youtube.com/embed/${encodeURIComponent(video)}?autoplay=1&rel=0`}
              title="Video"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        ) : original ? (
          <div className="flex flex-col" style={{ flex: 1, minHeight: 0 }}>
            {/* No allow-popups: a popup in the kiosk is a window with no way back. */}
            <iframe
              src={url}
              title="Original page"
              sandbox="allow-scripts allow-same-origin allow-forms"
              style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}
            />
            <div className="label px-3 py-1" style={{ color: "var(--ink-faint)" }}>
              Blank? Some sites refuse to be shown inside another page. Text view still works.
            </div>
          </div>
        ) : (
          <div ref={scroller} className="reader-body">
            {!loaded && <div className="label" style={{ padding: "2em 0" }}>Loading…</div>}
            {loaded?.kind === "error" && (
              <div style={{ padding: "2em 0" }}>
                <div className="font-bold">Couldn&apos;t load this one.</div>
                <div className="label" style={{ marginTop: 6 }}>{loaded.message}</div>
                <button
                  onClick={() => setOriginal(true)}
                  className="tag px-2 py-1 mt-3"
                  style={{ border: "1px solid var(--line)", borderRadius: 2 }}
                >
                  Try the original page
                </button>
              </div>
            )}
            {article && (
              <article>
                <h1 className="reader-title">{article.title}</h1>
                <div className="label" style={{ color: "var(--ink-faint)", marginBottom: 14 }}>
                  {article.site}
                  {article.published ? ` · ${ago(article.published)}` : ""}
                </div>
                {article.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={article.image} alt="" className="reader-image" />
                )}
                {(thin || !article.blocks.length) && article.description && (
                  <p className="reader-p">{article.description}</p>
                )}
                {article.blocks.map((b, i) =>
                  b.kind === "h" ? (
                    <h2 key={i} className="reader-h">{b.text}</h2>
                  ) : (
                    <p key={i} className="reader-p">{b.text}</p>
                  ),
                )}
                {/* Search results: each opens in this same reader. */}
                {article.links && article.links.length > 0 && (
                  <div className="reader-links">
                    {article.links.map((l) => (
                      <a key={l.url} href={l.url} className="reader-link">
                        {l.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        ) : <span className="reader-link-blank" />}
                        <span className="reader-link-title">{l.title}</span>
                        <span className="label">{l.note}</span>
                      </a>
                    ))}
                  </div>
                )}
                {thin && (
                  <div className="label" style={{ color: "var(--ink-faint)", marginTop: 12 }}>
                    This site keeps most of the story out of reach of readers.{" "}
                    <button onClick={() => setOriginal(true)} style={{ color: "var(--accent)" }}>
                      Open the original page
                    </button>
                  </div>
                )}
              </article>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
