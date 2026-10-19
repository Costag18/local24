import { MIRROR_HEIGHT, MIRROR_WIDTH } from "@/lib/mirror";

export const dynamic = "force-dynamic";

/**
 * The real dashboard on a PS3: http://<this computer>:3100/tv/live
 *
 * One full-screen picture that keeps replacing itself with a fresh screenshot
 * (lib/mirror.ts). The script is written for a 2006 browser — `var`, plain
 * functions, no arrow functions — and loads each new picture off-screen
 * before swapping it in, so the screen never flashes. With scripts off, the
 * page reloads itself every few seconds instead.
 */
export async function GET(req: Request) {
  // `?stream=1`: one MJPEG stream instead of picture after picture. Faster
  // where the browser can show it; no script needed at all.
  if (new URL(req.url).searchParams.get("stream") === "1") {
    return new Response(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>LOCAL 24</title>
<style type="text/css">html,body{margin:0;padding:0;background:#000000;overflow:hidden}img{display:block;width:100%;height:auto;border:0}</style>
</head><body><img src="/tv/live/stream" width="${MIRROR_WIDTH}" height="${MIRROR_HEIGHT}" alt=""></body></html>`, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const html = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<noscript><meta http-equiv="refresh" content="4"></noscript>
<title>LOCAL 24</title>
<style type="text/css">
html,body{margin:0;padding:0;background:#000000;overflow:hidden}
#f{display:block;width:100%;height:auto;border:0}
#msg{position:absolute;left:40px;top:40px;color:#8d9bb4;font-family:Arial,Helvetica,sans-serif;font-size:28px}
</style>
</head><body>
<div id="msg">LOCAL 24 is starting up&hellip;</div>
<img id="f" src="/tv/live/frame?t=${Date.now()}" width="${MIRROR_WIDTH}" height="${MIRROR_HEIGHT}" alt="">
<script type="text/javascript">
var el = document.getElementById("f");
var msg = document.getElementById("msg");
el.style.width = "100%";
el.style.height = "auto";
function next() {
  var img = new Image();
  img.onload = function () {
    el.src = img.src;
    if (msg) { msg.style.display = "none"; }
    setTimeout(next, 40);
  };
  img.onerror = function () { setTimeout(next, 2000); };
  img.src = "/tv/live/frame?t=" + (new Date()).getTime();
}
el.onload = function () { if (msg) { msg.style.display = "none"; } };
setTimeout(next, 800);
</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
