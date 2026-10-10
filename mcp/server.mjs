#!/usr/bin/env node
// MCP server that lets Claude point at things in the homebox-3d view.
// Pair it with a Homebox MCP (e.g. dgahagan/homebox-mcp) for reading/writing the
// inventory; this one only drives the camera.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const VIEWER = (process.env.HOMEBOX_3D_URL || 'http://127.0.0.1:7750').replace(/\/$/, '');

async function post(path, body) {
  let res;
  try {
    res = await fetch(VIEWER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new Error(`homebox-3d isn't running at ${VIEWER} — start it with \`npm start\`.`);
  }
  if (!res.ok) throw new Error(`homebox-3d ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });

const server = new McpServer({ name: 'homebox-3d', version: '0.1.0' });

server.registerTool(
  'show_in_3d',
  {
    title: 'Show in 3D',
    description:
      'Fly the homebox-3d camera to one or more items or locations and light them up with a beam. ' +
      'Use after answering a "where is…" question, or to visualise a set (e.g. everything worth over $500). ' +
      'Each query can be an item name, a location name or "Room/Shelf" path, an assetId, or a tag name ' +
      '(a tag highlights every item with it). Optionally pass a short caption to display next to the highlight.',
    inputSchema: {
      queries: z.array(z.string()).min(1).describe('Item/location names, paths, assetIds or tag names'),
      caption: z.string().max(140).optional().describe('Short note shown in the 3D view, e.g. "Top shelf, behind the paint"'),
    },
  },
  async ({ queries, caption }) => {
    const r = await post('/api/focus', { queries, caption });
    const lines = r.matches.slice(0, 25).map((m) => `• ${m.name} — ${m.path}`);
    if (r.matches.length > 25) lines.push(`…and ${r.matches.length - 25} more`);
    if (r.unmatched.length) lines.push(`Not found: ${r.unmatched.join(', ')}`);
    if (!r.viewers) lines.push(`(No browser has homebox-3d open — open ${VIEWER} to see it.)`);
    return text(`Highlighted ${r.matches.length} in 3D:\n${lines.join('\n')}`);
  },
);

server.registerTool(
  'clear_3d',
  { title: 'Clear 3D highlight', description: 'Remove highlights and return the homebox-3d camera to the overview.', inputSchema: {} },
  async () => {
    await post('/api/clear');
    return text('Cleared.');
  },
);

await server.connect(new StdioServerTransport());
