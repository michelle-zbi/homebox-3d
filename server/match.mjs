// Resolve loose queries ("drill", "Garage/Metal Shelf", "Electronics", an assetId)
// to nodes in a snapshot. Tags expand to every item carrying them.

export function pathOf(house, id) {
  const parts = [];
  for (let n = house.nodes[id]; n; n = house.nodes[n.parentId]) parts.unshift(n.name);
  return parts.join(' / ');
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}/ ]/gu, '').trim();

export function resolveQueries(house, queries) {
  const nodes = Object.values(house?.nodes || {});
  const found = new Map();
  const unmatched = [];

  for (const raw of queries) {
    const q = norm(String(raw));
    if (!q) continue;
    let hits = [];

    const tag = Object.keys(house.tags).find((t) => norm(t) === q);
    if (tag) hits = nodes.filter((n) => n.tags?.includes(tag));
    if (!hits.length) hits = nodes.filter((n) => n.id === raw || (n.assetId && n.assetId === raw));
    if (!hits.length) hits = nodes.filter((n) => norm(n.name) === q);
    if (!hits.length && q.includes('/')) {
      const want = q.split('/').map((s) => s.trim()).join(' / ');
      hits = nodes.filter((n) => norm(pathOf(house, n.id)).endsWith(want));
    }
    if (!hits.length) {
      const words = q.split(/\s+/);
      const scored = nodes
        .map((n) => {
          const name = norm(n.name);
          const all = words.every((w) => name.includes(w) || name.includes(w.replace(/s$/, '')));
          return all ? { n, score: (n.kind === 'item' ? 0 : 100) + name.length } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score);
      hits = scored.slice(0, 5).map((s) => s.n);
    }

    if (hits.length) hits.forEach((n) => found.set(n.id, n));
    else unmatched.push(raw);
  }

  return {
    matches: [...found.values()].map((n) => ({ id: n.id, name: n.name, kind: n.kind, path: pathOf(house, n.id) })),
    unmatched,
  };
}
