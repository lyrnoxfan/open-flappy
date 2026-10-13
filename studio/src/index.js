/* flappy-studio Worker
 * 整蛊游戏批量生产平台：
 *   GET  /                -> 工作台 UI（Basic Auth）
 *   POST /api/variants    -> 一键生成版本（multipart）
 *   GET  /api/variants    -> 版本列表
 *   DELETE /api/variants/:slug -> 删除版本
 *   GET  /g/:slug/        -> 游戏页（注入配置）
 *   GET  /g/:slug/a/:name -> 素材（KV，缺省回退默认）
 *
 * 构建时 deploy.py 把工作台 HTML 与游戏模板以内联 const 形式拼在脚本开头。
 */

const ASSET_FILES = {
  head: "head.png",
  handTop: "hand-top.png",
  handBottom: "hand-bottom.png",
  grass: "grass.png",
  phone: "phone.png",
  flap: "flap.mp3",
};
const MIME = { ".png": "image/png", ".mp3": "audio/mpeg" };
const TEXT_FIELDS = ["title", "subtitle", "overTitle", "overSub", "scoreLabel", "bestLabel", "btnRetry", "btnHome"];
const TEXT_DEFAULTS = {
  title: "整蛊快跳",
  subtitle: "冲冲冲，千万别被抓住了呀！嘻嘻",
  overTitle: "坠机了",
  overSub: "再来一次叭~",
  scoreLabel: "逃脱次数",
  bestLabel: "最佳 BEST",
  btnRetry: "就这啊？",
  btnHome: "你也不行啊",
};

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function checkAuth(req) {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let decoded = "";
  try { decoded = atob(h.slice(6)); } catch (e) { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const pass = decoded.slice(i + 1);
  const want = STUDIO_PASSWORD || "";
  if (!want || pass.length !== want.length) return false;
  let diff = 0;
  for (let j = 0; j < want.length; j++) diff |= pass.charCodeAt(j) ^ want.charCodeAt(j);
  return diff === 0;
}

function needAuth() {
  return new Response("需要密码", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="flappy-studio"' },
  });
}

function validHex(s) {
  return /^#[0-9a-fA-F]{6}$/.test(s || "") ? s : null;
}

async function serveGame(slug) {
  const cfg = await KV.get("v:" + slug, "json");
  if (!cfg) return new Response("版本不存在", { status: 404 });
  let html = GAME_HTML;
  const cj = JSON.stringify(cfg).replace(/</g, "\\u003c");
  html = html.split("__CONFIG_JSON__").join(cj);
  const pairs = [
    ["TITLE", cfg.title], ["SUBTITLE", cfg.subtitle],
    ["OVER_TITLE", cfg.overTitle], ["OVER_SUB", cfg.overSub],
    ["SCORE_LABEL", cfg.scoreLabel], ["BEST_LABEL", cfg.bestLabel],
    ["BTN_RETRY", cfg.btnRetry], ["BTN_HOME", cfg.btnHome],
  ];
  for (const [k, v] of pairs) html = html.split("__" + k + "__").join(escHtml(v));
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function serveAsset(slug, name) {
  const okNames = Object.values(ASSET_FILES);
  if (!okNames.includes(name)) return new Response("not found", { status: 404 });
  let buf = await KV.get("a:" + slug + ":" + name, "arrayBuffer");
  if (!buf) buf = await KV.get("a:default:" + name, "arrayBuffer");
  if (!buf) return new Response("not found", { status: 404 });
  const ext = name.slice(name.lastIndexOf("."));
  return new Response(buf, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

async function apiCreate(req) {
  const form = await req.formData();
  const slug = String(form.get("slug") || "").trim();
  if (!/^[a-z0-9-]{2,32}$/.test(slug)) return json({ error: "代号只能用小写字母、数字、横线（2-32位）" }, 400);
  if (await KV.get("v:" + slug)) return json({ error: "代号已存在，换一个" }, 409);

  const cfg = { slug, createdAt: Date.now() };
  for (const k of TEXT_FIELDS) {
    const v = String(form.get(k) || "").trim().slice(0, 80);
    cfg[k] = v || TEXT_DEFAULTS[k];
  }
  cfg.accent = validHex(form.get("accent")) || "#f2669e";
  cfg.accentNight = validHex(form.get("accentNight")) || "#ff8fb3";
  await KV.put("v:" + slug, JSON.stringify(cfg));

  for (const [field, fname] of Object.entries(ASSET_FILES)) {
    const f = form.get("file_" + field);
    if (f && typeof f.arrayBuffer === "function" && f.size > 0) {
      if (f.size > 4 * 1024 * 1024) {
        await KV.delete("v:" + slug);
        return json({ error: fname + " 太大（超过 4MB）" }, 400);
      }
      const buf = await f.arrayBuffer();
      await KV.put("a:" + slug + ":" + fname, buf);
    }
  }
  return json({ ok: true, url: "/g/" + slug + "/" });
}

async function apiList() {
  const out = [];
  let cursor = undefined;
  do {
    const r = await KV.list({ prefix: "v:", cursor });
    for (const k of r.keys) {
      const cfg = await KV.get(k.name, "json");
      if (cfg) out.push({ slug: cfg.slug, title: cfg.title, createdAt: cfg.createdAt });
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return json(out);
}

async function apiDelete(slug) {
  if (!/^[a-z0-9-]{2,32}$/.test(slug)) return json({ error: "bad slug" }, 400);
  await KV.delete("v:" + slug);
  let cursor = undefined;
  do {
    const r = await KV.list({ prefix: "a:" + slug + ":", cursor });
    for (const k of r.keys) await KV.delete(k.name);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return json({ ok: true });
}

async function handleFetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/") {
      if (!checkAuth(req)) return needAuth();
      return new Response(STUDIO_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (p.startsWith("/api/")) {
      if (!checkAuth(req)) return json({ error: "unauthorized" }, 401);
      if (p === "/api/variants" && req.method === "POST") return apiCreate(req);
      if (p === "/api/variants" && req.method === "GET") return apiList();
      const m = p.match(/^\/api\/variants\/([a-z0-9-]{2,32})$/);
      if (m && req.method === "DELETE") return apiDelete(m[1]);
      return json({ error: "not found" }, 404);
    }

    const mg = p.match(/^\/g\/([a-z0-9-]{2,32})(\/a\/([a-z-]+\.(png|mp3)))?\/?$/);
    if (mg) {
      const slug = mg[1];
      if (mg[2]) return serveAsset(slug, mg[3]);
      if (!p.endsWith("/")) {
        return Response.redirect(url.origin + "/g/" + slug + "/", 301);
      }
      return serveGame(slug);
    }

    return new Response("not found", { status: 404 });
  }

addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event.request));
});
