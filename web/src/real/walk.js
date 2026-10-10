// First-person walkthrough for the realistic style: WASD + mouse look at eye
// height, walls and furniture you can't pass through, doors between rooms, and a
// glide to stand in front of whatever Claude (or search) points at.
import * as THREE from 'three';

const EYE = 1.62;
const SPEED = 2.2; // m/s, Shift doubles it
const RADIUS = 0.28; // how close you can get to walls/furniture

export class Walker {
  constructor({ camera, controls, dom, onExit }) {
    Object.assign(this, { camera, controls, dom, onExit });
    this.active = false;
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector3();
    this.keys = new Set();
    this.glide = null;
    this.walkable = [];
    this.blockers = [];
    this.saved = null;
    this.drag = null;

    addEventListener('keydown', (e) => {
      if (!this.active || e.target.closest?.('input')) return;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (document.pointerLockElement !== dom) this.drag = [e.clientX, e.clientY];
    });
    addEventListener('mouseup', () => (this.drag = null));
    addEventListener('mousemove', (e) => {
      if (!this.active) return;
      let dx = 0, dy = 0;
      if (document.pointerLockElement === dom) [dx, dy] = [e.movementX, e.movementY];
      else if (this.drag) {
        [dx, dy] = [e.clientX - this.drag[0], e.clientY - this.drag[1]];
        this.drag = [e.clientX, e.clientY];
      } else return;
      this.glide = null;
      this.yaw -= dx * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0025, -1.2, 1.2);
    });

    this.minimap = document.createElement('canvas');
    this.minimap.id = 'minimap';
    this.minimap.hidden = true;
    document.body.appendChild(this.minimap);
    this.hud = document.createElement('div');
    this.hud.id = 'walk-hud';
    this.hud.hidden = true;
    this.hud.innerHTML = '<div class="crosshair"></div><div class="where"></div><div class="hint">WASD to walk · drag or click to look around · Shift to run · Esc to leave</div>';
    document.body.appendChild(this.hud);
  }

  // Walkable floor = room interiors + door corridors; furniture footprints block.
  setLayout(layout, doors) {
    this.layout = layout;
    this.walkable = [];
    this.rooms = [];
    for (const f of layout.floors) for (const r of f.rooms) {
      const rect = { x0: r.wx - r.w / 2 + 0.1 + RADIUS, x1: r.wx + r.w / 2 - 0.1 - RADIUS, z0: r.wz - r.d / 2 + 0.1 + RADIUS, z1: r.wz + r.d / 2 - 0.1 - RADIUS, y: f.y, room: r };
      this.walkable.push(rect);
      this.rooms.push(rect);
    }
    for (const d of doors) this.walkable.push({ ...d });
    this.blockers = [];
    for (const fu of Object.values(layout.furniture)) {
      if (fu.mount || fu.kind === 'rug' || ['lounge', 'dining', 'rug'].includes(fu.piece)) continue;
      const turned = Math.abs(Math.sin(fu.rot || 0)) > 0.5;
      const [w, d] = turned ? [fu.d, fu.w] : [fu.w, fu.d];
      const shrink = fu.piece === 'bed' ? 0.1 : 0;
      this.blockers.push({ x0: fu.wx - w / 2 - RADIUS + shrink, x1: fu.wx + w / 2 + RADIUS - shrink, z0: fu.wz - d / 2 - RADIUS + shrink, z1: fu.wz + d / 2 + RADIUS - shrink, y: fu.wy });
    }
    this.drawMinimapBase();
  }

  free(x, z, y) {
    const inRect = (r) => Math.abs(r.y - y) < 0.5 && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
    return this.walkable.some(inRect) && !this.blockers.some(inRect);
  }

  roomAt(x, z, y) {
    return this.rooms.find((r) => Math.abs(r.y - y) < 0.5 && x > r.x0 - 0.5 && x < r.x1 + 0.5 && z > r.z0 - 0.5 && z < r.z1 + 0.5)?.room;
  }

  // A free spot to stand in a room, preferring its middle-front (where people walk in).
  standIn(room) {
    const y = room.wy;
    for (const fz of [0.75, 0.6, 0.85, 0.5, 0.95, 0.4]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const x = room.wx - room.w / 2 + room.w * fx;
      const z = room.wz - room.d / 2 + room.d * fz;
      if (this.free(x, z, y)) return new THREE.Vector3(x, y, z);
    }
    return new THREE.Vector3(room.wx, y, room.wz);
  }

  enter(room) {
    if (!this.active) this.saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
    this.active = true;
    this.controls.enabled = false;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'YXZ';
    const p = this.standIn(room);
    this.pos.copy(p);
    // face the back wall of the room (where its storage and built-ins are)
    this.yaw = 0;
    this.pitch = -0.12;
    this.hud.hidden = false;
    this.minimap.hidden = false;
    document.body.classList.add('walking');
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.glide = null;
    if (document.pointerLockElement) document.exitPointerLock();
    this.controls.enabled = true;
    this.camera.fov = this.saved?.fov ?? 30;
    this.camera.updateProjectionMatrix();
    if (this.saved) {
      this.camera.position.copy(this.saved.pos);
      this.controls.target.copy(this.saved.target);
    }
    this.hud.hidden = true;
    this.minimap.hidden = true;
    document.body.classList.remove('walking');
    this.onExit?.();
  }

  // Walk over to stand in front of a world point on a piece of furniture and look at it.
  goTo(target, furniture) {
    let stand;
    if (furniture) {
      // search a fan of spots in front of the piece (its local +z) for a free one,
      // preferring a comfortable viewing distance straight ahead
      const rot = furniture.rot || 0;
      const base = Math.atan2(Math.sin(rot), Math.cos(rot));
      const front = (furniture.d || 0.6) / 2;
      const dists = furniture.mount ? [2.0, 2.3, 1.8, 2.6, 1.5] : [1.4, 1.7, 1.2, 2.0, 2.4];
      search: for (const dist of dists) {
        for (const da of [0, 0.35, -0.35, 0.7, -0.7, 1.0, -1.0]) {
          const a = base + da;
          const x = target.x + Math.sin(a) * (front + dist);
          const z = target.z + Math.cos(a) * (front + dist);
          if (this.free(x, z, furniture.wy)) { stand = new THREE.Vector3(x, furniture.wy, z); break search; }
        }
      }
    }
    if (!stand) {
      const room = this.roomAt(target.x, target.z, target.y - 0.5) || this.roomAt(target.x, target.z, target.y - 1.5);
      stand = room ? this.standIn(room) : new THREE.Vector3(target.x, target.y - 1, target.z + 1.5);
    }
    const eye = stand.clone().setY(stand.y + EYE);
    const dir = target.clone().sub(eye);
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    // teleport if it's another floor, otherwise glide
    if (Math.abs(stand.y - this.pos.y) > 0.5) this.pos.copy(stand);
    let dyaw = yaw - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.glide = { from: this.pos.clone(), to: stand, yaw0: this.yaw, yaw1: this.yaw + dyaw, p0: this.pitch, p1: pitch, t: 0, dur: Math.min(2.6, 0.9 + this.pos.distanceTo(stand) * 0.35) };
  }

  update(dt) {
    if (!this.active) return;
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.dur);
      const k = g.t * g.t * (3 - 2 * g.t);
      this.pos.lerpVectors(g.from, g.to, k);
      this.yaw = g.yaw0 + (g.yaw1 - g.yaw0) * k;
      this.pitch = g.p0 + (g.p1 - g.p0) * k;
      if (g.t >= 1) this.glide = null;
    } else {
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      if (f || s) {
        const speed = SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2 : 1) * dt;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const dx = (fx * f + -fz * s) * speed;
        const dz = (fz * f + fx * s) * speed;
        const y = this.pos.y;
        // slide along walls: try both axes, then each alone
        if (this.free(this.pos.x + dx, this.pos.z + dz, y)) { this.pos.x += dx; this.pos.z += dz; }
        else if (this.free(this.pos.x + dx, this.pos.z, y)) this.pos.x += dx;
        else if (this.free(this.pos.x, this.pos.z + dz, y)) this.pos.z += dz;
      }
    }
    // gentle head bob while moving
    const moving = this.keys.size > 0 && !this.glide;
    this.bob = (this.bob || 0) + (moving ? dt * 9 : 0);
    this.camera.position.set(this.pos.x, this.pos.y + EYE + (moving ? Math.sin(this.bob) * 0.018 : 0), this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const room = this.roomAt(this.pos.x, this.pos.z, this.pos.y);
    const where = this.hud.querySelector('.where');
    if (room && where.textContent !== room.name) where.textContent = room.name;
    this.drawMinimap();
  }

  drawMinimapBase() {
    const fl = this.layout.floors;
    this.mapFloors = fl.map((f) => {
      const xs = f.rooms.flatMap((r) => [r.wx - r.w / 2, r.wx + r.w / 2]);
      const zs = f.rooms.flatMap((r) => [r.wz - r.d / 2, r.wz + r.d / 2]);
      return { f, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    });
  }

  drawMinimap() {
    const c = this.minimap;
    const mf = this.mapFloors?.find((m) => Math.abs(m.f.y - this.pos.y) < 0.5);
    if (!mf) return;
    const W = 220;
    const scale = (W - 20) / Math.max(mf.x1 - mf.x0, mf.z1 - mf.z0);
    const H = Math.round((mf.z1 - mf.z0) * scale + 20);
    const dpr = Math.min(2, devicePixelRatio);
    if (c.width !== W * dpr || c.height !== H * dpr) {
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const X = (x) => 10 + (x - mf.x0) * scale;
    const Z = (z) => 10 + (z - mf.z0) * scale;
    const here = this.roomAt(this.pos.x, this.pos.z, this.pos.y);
    for (const r of mf.f.rooms) {
      ctx.fillStyle = r === here ? 'rgba(255,184,107,.22)' : 'rgba(255,255,255,.06)';
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.fillRect(X(r.wx - r.w / 2), Z(r.wz - r.d / 2), r.w * scale, r.d * scale);
      ctx.strokeRect(X(r.wx - r.w / 2) + 0.5, Z(r.wz - r.d / 2) + 0.5, r.w * scale - 1, r.d * scale - 1);
    }
    const px = X(this.pos.x), pz = Z(this.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.yaw);
    ctx.fillStyle = 'rgba(255,184,107,.25)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 26, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffb86b';
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
