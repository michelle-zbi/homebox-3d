# homebox-3d

**Your [Homebox](https://homebox.software) inventory as a live 3D dollhouse — and an MCP server so Claude can point at things in it.**

![homebox-3d demo](docs/demo.gif)

Ask Claude *"where's my passport?"* and the camera flies to the keepsake box on the closet shelf and lights it up. Tell it *"I moved the drill to the office"* and you watch the drill arc across the house onto the desk. Every room, shelf, tote and item comes straight from Homebox — nothing to model by hand.

- **Generated from your data** — top-level locations become rooms, locations inside them become furniture (picked from the name: *shelf*, *desk*, *tote*, *closet*…), nested locations become see-through totes, and every item becomes a small block coloured by tag.
- **Live** — homebox-3d watches Homebox. Items added, moved, renamed or removed (from the Homebox UI, the API, or Claude) animate in place, and the camera follows.
- **Claude can point** — the bundled `show_in_3d` MCP tool flies the camera to items, locations, paths or whole tags, with a caption.
- **Search** — <kbd>⌘K</kbd>, type, <kbd>Enter</kbd>. Click any item for the same treatment; hover for details and photos.
- **Multiple floors** — rooms named *attic/upstairs/loft* go up a level, *basement/cellar* go down, laid out as an exploded staircase.

## Two looks

- **Diorama** (default): the stylised dollhouse in the GIF, items as colour-coded blocks.
- **Realistic** (◧ button, or `?style=real`): wood/tile/marble floors, full-height walls that drop away on the camera's side, kitchens with counters, sink, range and fridge, beds, sofas, bathrooms — with your Homebox storage turned into real cabinets, wall cabinets and pulled-out drawers. Free-standing furniture uses CC0 models from Poly Haven (see [CREDITS](CREDITS.md)).
  - **🚶 Walk**: first-person walkthrough with ceilings, doorways and windows — WASD + mouse, Shift to run, Esc to leave. When Claude (or search) points at something, you glide over to it.

### Your actual house (optional, stays local)

`house.json` (gitignored) lets the realistic view follow your real home:

```bash
npm run footprint -- "123 Main St, Springfield"   # building outline from OpenStreetMap
```

```json
{
  "footprint": [[-6.2, -11.9], [-6.1, 12.2], …],
  "parking": [{ "model": "sedan", "color": "#a8141e" }, { "model": "coupe", "color": "#c4c7cb" }]
}
```

`parking` puts your cars (`sedan` or `coupe`, any colour) in the garage — or the basement if there's no garage. Don't commit this file: it pins down where you live.

## How it fits together

```
 Claude ──► homebox-mcp ──► Homebox ◄── polls ── homebox-3d server ──SSE──► three.js view
   │                        (your data)                ▲
   └──────► homebox-3d MCP (show_in_3d) ───────────────┘
```

Claude reads and edits your inventory through a Homebox MCP server (for example [dgahagan/homebox-mcp](https://github.com/dgahagan/homebox-mcp)). homebox-3d polls Homebox, pushes changes to the browser, and accepts "look at this" requests from its own small MCP server. Your Homebox token stays on the server.

## Quick start

You need Node 20+ and a Homebox **0.26+** instance (the [sysadminsmedia](https://github.com/sysadminsmedia/homebox) build; Docker or the single binary from its releases both work).

```bash
git clone https://github.com/michelle-zbi/homebox-3d && cd homebox-3d
npm install
cp .env.example .env          # set HOMEBOX_URL and HOMEBOX_TOKEN (Homebox → Profile → API Keys)
npm run build && npm start    # → http://127.0.0.1:7750
```

`npm run dev` runs the same server with Vite hot-reload.

### Try it without touching your inventory

Run a throwaway Homebox and fill it with the demo house from the GIF:

```bash
mkdir -p /tmp/hb-demo && cd /tmp/hb-demo
HBOX_WEB_PORT=7746 HBOX_AUTH_API_KEY_PEPPER=$(openssl rand -hex 32) ./homebox &   # or the Docker image on 7746
cd - && npm run seed                                                            # demo@example.com / demo-password
printf 'HOMEBOX_URL=http://127.0.0.1:7746\nHOMEBOX_EMAIL=demo@example.com\nHOMEBOX_PASSWORD=demo-password\n' > .env
npm run dev
```

## Hook it up to Claude

Add both MCP servers (Claude Code shown; any MCP client works):

```bash
# read/write the inventory
claude mcp add homebox --scope user \
  -e HOMEBOX_URL=http://127.0.0.1:7745 -e HOMEBOX_TOKEN=hb_xxx -- uvx homebox-mcp

# point at things in 3D
claude mcp add homebox-3d --scope user \
  -e HOMEBOX_3D_URL=http://127.0.0.1:7750 -- node /absolute/path/to/homebox-3d/mcp/server.mjs
```

Then just talk to it:

> *Where are my hiking boots?* → Claude searches Homebox, answers, and calls `show_in_3d`.
>
> *Show me everything worth more than $500.* → one beam per item.
>
> *I just put the tent back in the camping bin.* → `move_item` in Homebox; the tent flies there in 3D.

| Tool | What it does |
|------|--------------|
| `show_in_3d(queries[], caption?)` | Fly to and highlight items/locations. A query can be a name, a `Room/Shelf` path, an assetId, or a tag (highlights every item with it). |
| `clear_3d()` | Drop the highlight and go back to the overview. |

## Naming things so the house looks right

The layout is inferred from location names, so a little naming goes a long way:

| Location name contains | Rendered as |
|---|---|
| desk, table, bench, counter, island, workbench | table — items sit on top |
| tote, bin, box, crate, basket, trunk, chest, drawer, freezer | open crate on the floor |
| cabinet, closet, wardrobe, dresser, nightstand, pantry, console | open-front cabinet with shelves |
| shelf, rack, bookcase, stand, cart (and anything else) | metal shelving |
| *a location inside one of the above* | translucent tote with its items inside |

Top-level locations are rooms. *Attic / upstairs / loft / 2nd floor* rooms go up a level, *basement / cellar* rooms go down. Items directly in a room sit on a rug. Item colour comes from the item's first tag (Homebox tag colours are respected).

## HTTP API

The server is small enough to script against:

| | |
|---|---|
| `GET /api/house` | the current snapshot (rooms, locations, items, tags) |
| `GET /api/events` | Server-Sent Events: `house` on every change, `focus` when something is highlighted |
| `POST /api/focus` | `{ "queries": ["drill"], "caption": "..." }` |
| `POST /api/clear` | clear the highlight |

## Security

homebox-3d listens on `127.0.0.1` by default and has no auth of its own — anyone who can reach it can see your whole inventory. If you expose it beyond localhost, put it behind something that authenticates (Tailscale, a reverse proxy with auth, etc.).

## Development

```bash
npm run dev    # server + Vite hot reload
npm test       # layout tests
```

## License

MIT for the code. Bundled textures and models are CC0 — see [CREDITS](CREDITS.md).
