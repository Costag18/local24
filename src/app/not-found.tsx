/**
 * A wrong turn, with a way back.
 *
 * The kiosk window has no address bar or back button, so landing on a page
 * that does not exist used to strand the screen on Next's bare 404. Now it
 * offers the dashboard, and goes there by itself after a few seconds.
 */
export default function NotFound() {
  return (
    <div className="grid place-items-center h-screen">
      <meta httpEquiv="refresh" content="8;url=/" />
      <div className="text-center">
        <div className="font-black" style={{ fontSize: "2em", letterSpacing: "-0.02em" }}>
          LOCAL<span style={{ color: "var(--accent)" }}>24</span>
        </div>
        <div className="label" style={{ marginTop: 8 }}>That page doesn&apos;t exist.</div>
        <a
          href="/"
          className="reader-back"
          style={{ display: "inline-block", marginTop: 16 }}
        >
          ← Back to LOCAL 24
        </a>
        <div className="label" style={{ marginTop: 10, color: "var(--ink-faint)" }}>Going back automatically…</div>
      </div>
    </div>
  );
}
