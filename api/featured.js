// 最新の同人誌を n 件だけカードHTMLで返す（発行日で降順）
// プロパティ名：タイトル / 発行日(Date) / 通販リンク(URL) / サムネ(Filesまたはページカバー)
// 追加で 価格(Number) と 年齢制限(Select) を表示

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!token || !databaseId) {
      res.status(500).send('Missing NOTION_TOKEN or NOTION_DATABASE_ID');
      return;
    }

    const { searchParams } = new URL(req.url, 'http://localhost');
    const limit = clampInt(searchParams.get('limit') ?? '2', 1, 12);

    // 固定：あなたのDBのプロパティ名
    const PROP = {
      TITLE: '名前',        // Notion上のページタイトルは内部的には "Name" のことが多いですが、日本語DBだと表示名が「名前」ならそれでOK。もし違えばここを変えてください。
      DATE:  '発行日',      // Date
      LINK:  '通販リンク',  // URL
      COVER: 'サムネ',      // Files（無ければページカバーを使う）
      PRICE: '価格',        // Number
      AGE:   '年齢制限'     // Select
    };

    // 1) database_id → data_source_id（新API）
    const dsId = await getDataSourceId(databaseId, token);

    // 2) /data_sources/{id}/query（発行日があればそれで降順、なければ作成日時）
    const queryBody = {
      page_size: limit,
      sorts: [{ property: PROP.DATE, direction: 'descending' }]
    };

    const qres = await fetch(`https://api.notion.com/v1/data_sources/${dsId}/query`, {
      method: 'POST',
      headers: notionHeaders(token),
      body: JSON.stringify(queryBody)
    });
    if (!qres.ok) {
      const t = await qres.text();
      throw new Error(`Query failed: ${qres.status} ${t}`);
    }
    const data = await qres.json();

    const items = (data.results || []).map(page => mapPage(page, PROP));
    const html = renderHtml(items);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(html);

  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
}

function notionHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2025-09-03'
  };
}

async function getDataSourceId(databaseId, token) {
  const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, { headers: notionHeaders(token) });
  if (!r.ok) throw new Error(await r.text());
  const db = await r.json();
  const ds = db.data_sources?.[0]?.id;
  if (!ds) throw new Error('No data_source_id found.');
  return ds;
}

function mapPage(page, P) {
  const props = page.properties || {};

  const title =
    props[P.TITLE]?.title?.[0]?.plain_text ||
    props[P.TITLE]?.title?.[0]?.text?.content ||
    '(無題)';

  // 発行日（Date）
  const date = props[P.DATE]?.date?.start || '';

  // 通販リンク（URL）
  const link = props[P.LINK]?.url || page.public_url || '';

  // 表紙：ページカバー or サムネ(Files)
  let coverUrl = page.cover?.external?.url || page.cover?.file?.url || '';
  if (!coverUrl && props[P.COVER]?.files?.length) {
    const f = props[P.COVER].files[0];
    coverUrl = f.external?.url || f.file?.url || '';
  }

  // 価格（Number）・年齢制限（Select）
  const price = (props[P.PRICE]?.number != null) ? props[P.PRICE].number : null;
  const age   = props[P.AGE]?.select?.name || '';

  return { title, date, link, coverUrl, price, age };
}

function renderHtml(items) {
  const cards = items.map(it => `
    <a class="card" href="${escAttr(it.link || '#')}" target="_blank" rel="noopener">
      ${it.coverUrl ? `<div class="cover"><img src="${escAttr(it.coverUrl)}" alt=""></div>` : ''}
      <div class="body">
        <div class="title">${escHtml(it.title)}</div>
        <div class="meta">
          ${it.date ? `<span class="pill">${escHtml(it.date)}</span>` : ''}
          ${it.age  ? `<span class="pill pill--mute">${escHtml(it.age)}</span>` : ''}
          ${it.price != null ? `<span class="pill">¥${formatJPY(it.price)}</span>` : ''}
        </div>
      </div>
    </a>
  `).join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Featured</title>
<style>
:root{ --bg:#fff; --fg:#111; --muted:#666; --card:#fafafa; --border:#e5e7eb; --link:#0b57d0; }
@media (prefers-color-scheme: dark){
  :root{ --bg:#0b0b0b; --fg:#eaeaea; --muted:#a2a2a2; --card:#151515; --border:#262626; --link:#8ab4f8; }
}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
  font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,"Hiragino Sans","Noto Sans JP",sans-serif;}
.wrap{max-width:100%;padding:8px;box-sizing:border-box;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;}
.card{display:block;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit}
.cover{aspect-ratio:16/9;background:#ddd}
.cover img{width:100%;height:100%;object-fit:cover;display:block}
.body{padding:12px}
.title{font-weight:700}
.meta{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.pill{font-size:12px;background:#eef3ff;color:#1a3ea9;border:1px solid #d9e2ff;padding:2px 6px;border-radius:999px}
.pill--mute{background:#f1f3f5;color:#495057;border-color:#e9ecef}
</style>
</head>
<body>
  <div class="wrap">
    <div class="grid">
      ${cards || `<div style="color:var(--muted)">No items.</div>`}
    </div>
  </div>
</body>
</html>`;
}

function escHtml(s){return String(s??'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
function escAttr(s){return String(s??'').replace(/"/g,'&quot;');}
function clampInt(s, min, max){ const n = parseInt(s,10); return isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }
function formatJPY(n){ try{ return Number(n).toLocaleString('ja-JP'); } catch{ return String(n); } }
