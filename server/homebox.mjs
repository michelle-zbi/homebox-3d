// Minimal Homebox (>= 0.26, "entities" API) client that turns the inventory
// into one flat snapshot the 3D view can lay out.

export function createHomebox({ url, token, email, password }) {
  const base = url.replace(/\/$/, '') + '/api/v1';
  let auth = token || null;

  async function login() {
    const res = await fetch(`${base}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password, stayLoggedIn: true }),
    });
    if (!res.ok) throw new Error(`Homebox login failed (${res.status})`);
    auth = (await res.json()).token;
  }

  async function request(path, { raw = false, retry = true } = {}) {
    if (!auth && email) await login();
    const res = await fetch(base + path, { headers: auth ? { Authorization: auth } : {} });
    if (res.status === 401 && retry && email) {
      await login();
      return request(path, { raw, retry: false });
    }
    if (!res.ok) throw new Error(`Homebox ${path} -> ${res.status}`);
    return raw ? res : res.json();
  }

  async function snapshot() {
    const [tree, tags] = await Promise.all([
      request('/entities/tree?withItems=true'),
      request('/tags'),
    ]);

    // The tree has structure; the paged list has the item details we colour by.
    const details = {};
    for (let page = 1; ; page++) {
      const res = await request(`/entities?pageSize=500&page=${page}`);
      for (const it of res.items) details[it.id] = it;
      if (page * res.pageSize >= res.total || res.items.length === 0) break;
    }

    const nodes = {};
    const walk = (n, parentId, depth) => {
      const d = details[n.id] || {};
      nodes[n.id] = {
        id: n.id,
        name: n.name,
        kind: n.type === 'item' ? 'item' : 'location',
        parentId,
        depth,
        children: n.children.map((c) => c.id),
        ...(n.type === 'item' && {
          qty: d.quantity ?? 1,
          price: d.purchasePrice || 0,
          tags: (d.tags || []).map((t) => t.name),
          imageId: d.imageId || null,
          assetId: d.assetId || '',
          description: d.description || '',
        }),
      };
      n.children.forEach((c) => walk(c, n.id, depth + 1));
    };
    tree.forEach((n) => walk(n, null, 0));

    return {
      roots: tree.map((n) => n.id),
      nodes,
      tags: Object.fromEntries(tags.map((t) => [t.name, t.color || null])),
    };
  }

  const image = (entityId, attachmentId) =>
    request(`/entities/${entityId}/attachments/${attachmentId}`, { raw: true });

  return { snapshot, image };
}
