// ==============================================================================
// 2D TRUSS FEM SOLVER — FRONTEND LOGIC
// ==============================================================================
const API = 'http://127.0.0.1:8000';

// ── STATE ──────────────────────────────────────────────────────────────────────
const state = {
  nodes:    [],   // [{id, x, y, support: null|'pin'|'roller'|'roller-x', force: null|{mag,angle}}]
  members:  [],   // [{id, i, j}]
  selected: null, // {type:'node'|'member', id}
  tool:     'select',
  memberStart: null,   // node id when drawing member
  analysisResult: null,
  nextNodeId:   0,
  nextMemberId: 0,
  activePopupNode: null,
};

// ── CANVAS SETUP ───────────────────────────────────────────────────────────────
const canvas = document.getElementById('truss-canvas');
const ctx    = canvas.getContext('2d');
let   VIEW   = { offsetX: 0, offsetY: 0, scale: 60 }; // pixels per meter
let   isPanning = false, panStart = null;

function resize() {
  canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  centerView();
  draw();
}

function centerView() {
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  VIEW.offsetX = W / 2;
  VIEW.offsetY = H / 2;
}

// ── COORDINATE TRANSFORMS ──────────────────────────────────────────────────────
function worldToScreen(x, y) {
  return { sx: VIEW.offsetX + x * VIEW.scale, sy: VIEW.offsetY - y * VIEW.scale };
}
function screenToWorld(sx, sy) {
  return { x: (sx - VIEW.offsetX) / VIEW.scale, y: -(sy - VIEW.offsetY) / VIEW.scale };
}
function snapToGrid(val) {
  const g = +document.getElementById('grid-size').value || 1;
  const snap = document.getElementById('snap-toggle').checked;
  return snap ? Math.round(val / g) * g : parseFloat(val.toFixed(3));
}

// ── DRAWING ────────────────────────────────────────────────────────────────────
function draw() {
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  ctx.clearRect(0, 0, W, H);
  drawGrid(W, H);
  drawAxes(W, H);
  drawSelfWeightArrows();
  drawMembers();
  drawNodes();
  drawReactionArrows();
  if (state.memberStart !== null) drawMemberPreview();
}

function drawGrid(W, H) {
  const g = +document.getElementById('grid-size').value || 1;
  const step = VIEW.scale * g;
  ctx.strokeStyle = '#1e2130';
  ctx.lineWidth = 1;
  const startX = VIEW.offsetX % step;
  const startY = VIEW.offsetY % step;
  for (let x = startX; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = startY; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

function drawAxes(W, H) {
  ctx.strokeStyle = '#2a2d3e';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(VIEW.offsetX, 0); ctx.lineTo(VIEW.offsetX, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, VIEW.offsetY); ctx.lineTo(W, VIEW.offsetY); ctx.stroke();
}

function drawMembers() {
  state.members.forEach(m => {
    const ni = state.nodes.find(n => n.id === m.i);
    const nj = state.nodes.find(n => n.id === m.j);
    if (!ni || !nj) return;
    const pi = worldToScreen(ni.x, ni.y);
    const pj = worldToScreen(nj.x, nj.y);
    const isSelected = state.selected?.type === 'member' && state.selected.id === m.id;

    let color = '#4a5080', lw = 2.5;
    let isZeroForce = false;

    // Color from analysis result
    if (state.analysisResult) {
      const res = state.analysisResult.element_results.find(r => r.element_id === state.members.indexOf(m));
      if (res) {
        const maxF = Math.max(...state.analysisResult.element_results.map(r => r.force_kN), 0.001);
        const ratio = res.force_kN / maxF;

        if (res.force_kN < 0.001) {
          isZeroForce = true;
          color = '#ffffff';
          lw    = 1.5;
        } else {
          color = res.type === 'Compression'
            ? `rgba(255, 100, 100, ${0.5 + 0.5 * ratio})`
            : `rgba(70, 180, 255, ${0.5 + 0.5 * ratio})`;
          lw = 1.5 + 3.5 * ratio;
        }
      }
    }

    if (isSelected) { ctx.strokeStyle = '#ffd43b'; lw += 1; }
    else ctx.strokeStyle = color;

    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(pi.sx, pi.sy);
    ctx.lineTo(pj.sx, pj.sy);
    ctx.stroke();

    // Midpoint — used for both force label and member ID label
    const mx = (pi.sx + pj.sx) / 2;
    const my = (pi.sy + pj.sy) / 2;

    // Force label at midpoint
    if (state.analysisResult) {
      const res = state.analysisResult.element_results.find(r => r.element_id === state.members.indexOf(m));
      if (res) {
        const typeTag = isZeroForce ? 'Z' : (res.type === 'Compression' ? 'C' : 'T');
        ctx.fillStyle    = isZeroForce ? '#ffffff' : (res.type === 'Compression' ? '#ff6b6b' : '#4dabf7');
        ctx.font         = '11px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${res.force_kN.toFixed(2)}kN (${typeTag})`, mx, my - 4);
      }
    }

    // Member ID label
    ctx.fillStyle = '#3a3f5c';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`E${state.members.indexOf(m)}`, mx, my + 4);
  });
}

function drawNodes() {
  state.nodes.forEach(n => {
    const { sx, sy } = worldToScreen(n.x, n.y);
    const isSelected = state.selected?.type === 'node' && state.selected.id === n.id;
    const radius = 7;

    // Draw support symbol
    if (n.support === 'pin') drawPin(sx, sy);
    else if (n.support === 'roller') drawRoller(sx, sy, 'y');
    else if (n.support === 'roller-x') drawRoller(sx, sy, 'x');

    // Draw force arrow
    if (n.forces && n.forces.length > 0) {
      n.forces.forEach(f => drawForceArrow(sx, sy, f.mag, f.angle));
    }

    // Draw node circle
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? '#ffd43b' : (n.support ? '#69db7c' : '#4dabf7');
    ctx.fill();
    ctx.strokeStyle = '#0c0e18';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Node label
    const idx = state.nodes.indexOf(n);
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`N${idx}`, sx + 9, sy - 2);

    // Coordinate label
    ctx.fillStyle = '#5c6280';
    ctx.font = '9px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`(${n.x.toFixed(1)}, ${n.y.toFixed(1)})`, sx + 9, sy + 2);
  });
}

function drawPin(sx, sy) {
  const s    = 14;
  const base = sy + 8 + s;   // y-coordinate of triangle base
  ctx.fillStyle   = '#339af044';
  ctx.strokeStyle = '#74c0fc';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 8);
  ctx.lineTo(sx - s, base);
  ctx.lineTo(sx + s, base);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Ground line directly under base
  ctx.strokeStyle = '#74c0fc';
  ctx.beginPath();
  ctx.moveTo(sx - s, base);
  ctx.lineTo(sx + s, base);
  ctx.stroke();

  // Hatch lines — evenly spaced, start from base left to right
  ctx.strokeStyle = '#74c0fc88';
  ctx.lineWidth   = 1;
  const hatchSpacing = 5;
  const hatchLen     = 6;
  for (let i = -s + 2; i <= s; i += hatchSpacing) {
    ctx.beginPath();
    ctx.moveTo(sx + i,              base);
    ctx.lineTo(sx + i - hatchLen,  base + hatchLen);
    ctx.stroke();
  }
}

function drawRoller(sx, sy, axis) {
  const r = 5;
  ctx.fillStyle = '#2f9e4444';
  ctx.strokeStyle = '#69db7c';
  ctx.lineWidth = 1.5;
  if (axis === 'y') {
    ctx.beginPath(); ctx.arc(sx - r, sy + 10, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + r, sy + 10, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 14, sy + 17); ctx.lineTo(sx + 14, sy + 17); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(sx + 10, sy - r, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx + 10, sy + r, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 17, sy - 14); ctx.lineTo(sx + 17, sy + 14); ctx.stroke();
  }
}

function drawForceArrow(sx, sy, mag, angleDeg) {
  const scale = 35;
  const rad   = angleDeg * Math.PI / 180;
  const dx    = Math.cos(rad) * scale;
  const dy    = -Math.sin(rad) * scale;
  const ex    = sx + dx, ey = sy + dy;

  ctx.strokeStyle = '#ffa94d';
  ctx.fillStyle   = '#ffa94d';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

  // Arrowhead
  const headLen = 10, headAngle = 0.4;
  const angle = Math.atan2(ey - sy, ex - sx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - headAngle), ey - headLen * Math.sin(angle - headAngle));
  ctx.lineTo(ex - headLen * Math.cos(angle + headAngle), ey - headLen * Math.sin(angle + headAngle));
  ctx.closePath(); ctx.fill();

  // Label
  ctx.fillStyle = '#ffa94d';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${mag}kN`, ex + dx * 0.3, ey + dy * 0.3 - 8);
}

function drawMemberPreview() {
  const ni = state.nodes.find(n => n.id === state.memberStart);
  if (!ni) return;
  const pi = worldToScreen(ni.x, ni.y);
  ctx.strokeStyle = '#ffd43b88';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pi.sx, pi.sy);
  ctx.lineTo(state._mouseX || pi.sx, state._mouseY || pi.sy);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawReactionArrows() {
  if (!state.analysisResult) return;
  const reactions = state.analysisResult.reactions;
  if (!reactions || reactions.length === 0) return;

  // Find max reaction magnitude for scaling
  const maxR = Math.max(...reactions.flatMap(r => [Math.abs(r.rx_kN), Math.abs(r.ry_kN)]), 0.001);
  const arrowLen = VIEW.scale * 0.8;   // fixed visual length in pixels

  reactions.forEach(r => {
    const n = state.nodes[r.node_id];
    if (!n) return;
    const { sx, sy } = worldToScreen(n.x, n.y);

    // Rx arrow (horizontal)
    if (Math.abs(r.rx_kN) > 0.001) {
      const ratio = Math.abs(r.rx_kN) / maxR;
      const len   = arrowLen * (0.4 + 0.6 * ratio);
      const dir   = r.rx_kN >= 0 ? 1 : -1;
      drawReactionArrow(sx, sy, sx + dir * len, sy, r.rx_kN.toFixed(2) + 'kN');
    }
    // Ry arrow (vertical)
    if (Math.abs(r.ry_kN) > 0.001) {
      const ratio = Math.abs(r.ry_kN) / maxR;
      const len   = arrowLen * (0.4 + 0.6 * ratio);
      const dir   = r.ry_kN >= 0 ? -1 : 1;   // screen Y is flipped
      drawReactionArrow(sx, sy, sx, sy + dir * len, r.ry_kN.toFixed(2) + 'kN');
    }
  });
}

function drawReactionArrow(x1, y1, x2, y2, label) {
  const headLen   = 10;
  const headAngle = 0.4;
  const angle     = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = '#cc5de8';
  ctx.fillStyle   = '#cc5de8';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - headAngle), y2 - headLen * Math.sin(angle - headAngle));
  ctx.lineTo(x2 - headLen * Math.cos(angle + headAngle), y2 - headLen * Math.sin(angle + headAngle));
  ctx.closePath();
  ctx.fill();

  // Label
  ctx.fillStyle    = '#cc5de8';
  ctx.font         = '10px monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, (x1 + x2) / 2, Math.min(y1, y2) - 3);
}

function drawSelfWeightArrows() {
  if (!document.getElementById('sw-toggle').checked) return;
  if (state.nodes.length === 0 || state.members.length === 0) return;

  const A   = +document.getElementById('mat-A').value * 1e-4;
  const g   = +document.getElementById('sw-g').value;
  const rho = +document.getElementById('sw-rho').value;

  // Compute self-weight per node
  const sw = {};
  state.members.forEach(m => {
    const ni = state.nodes.find(n => n.id === m.i);
    const nj = state.nodes.find(n => n.id === m.j);
    if (!ni || !nj) return;
    const L = Math.hypot(nj.x - ni.x, nj.y - ni.y);
    const W = rho * A * L * g / 2;   // half to each node (N)
    [m.i, m.j].forEach(id => {
      if (!sw[id]) sw[id] = 0;
      sw[id] += W;
    });
  });

  const maxSW = Math.max(...Object.values(sw), 0.001);

  Object.entries(sw).forEach(([idStr, W]) => {
    const id = +idStr;
    const n  = state.nodes.find(n => n.id === id);
    if (!n) return;
    const { sx, sy } = worldToScreen(n.x, n.y);
    const len = VIEW.scale * 0.5 * (W / maxSW + 0.3);

    // Draw downward arrow (self-weight always down)
    ctx.strokeStyle = '#94d82d88';
    ctx.fillStyle   = '#94d82d88';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy + len);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(sx, sy + len);
    ctx.lineTo(sx - 5, sy + len - 8);
    ctx.lineTo(sx + 5, sy + len - 8);
    ctx.closePath();
    ctx.fill();

    // Label (in N, small)
    ctx.fillStyle    = '#94d82d88';
    ctx.font         = '9px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${(W / 1000).toFixed(3)}kN`, sx + 6, sy + len * 0.4);
  });
}

// ── CANVAS EVENTS ──────────────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const sx   = e.clientX - rect.left;
  const sy   = e.clientY - rect.top;
  const raw  = screenToWorld(sx, sy);
  const x    = snapToGrid(raw.x);
  const y    = snapToGrid(raw.y);

  if (state.tool === 'node') {
    // Check if clicking existing node
    const hit = hitTestNode(sx, sy);
    if (!hit) {
      addNode(x, y);
      document.getElementById('canvas-hint').classList.add('hidden');
    }
  } else if (state.tool === 'member') {
    const hit = hitTestNode(sx, sy);
    if (hit !== null) {
      if (state.memberStart === null) {
        state.memberStart = hit;
      } else {
        if (state.memberStart !== hit) addMember(state.memberStart, hit);
        state.memberStart = null;
      }
    }
  } else if (state.tool === 'support') {
    const hit = hitTestNode(sx, sy);
    if (hit !== null) openSupportPopup(hit);
  } else if (state.tool === 'force') {
    const hit = hitTestNode(sx, sy);
    if (hit !== null) openForcePopup(hit);
  } else if (state.tool === 'select') {
    const hitN = hitTestNode(sx, sy);
    const hitM = hitTestMember(sx, sy);
    if (hitN !== null) state.selected = { type: 'node', id: hitN };
    else if (hitM !== null) state.selected = { type: 'member', id: hitM };
    else state.selected = null;
  }
  draw();
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const sx   = e.clientX - rect.left;
  const sy   = e.clientY - rect.top;
  const raw  = screenToWorld(sx, sy);
  const x    = snapToGrid(raw.x);
  const y    = snapToGrid(raw.y);
  document.getElementById('coord-display').textContent = `x: ${x.toFixed(2)} | y: ${y.toFixed(2)}`;
  state._mouseX = sx; state._mouseY = sy;

  if (isPanning && panStart) {
    VIEW.offsetX += sx - panStart.x;
    VIEW.offsetY += sy - panStart.y;
    panStart = { x: sx, y: sy };
  }
  draw();
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    isPanning = true;
    const rect = canvas.getBoundingClientRect();
    panStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
});
canvas.addEventListener('mouseup',   () => { isPanning = false; panStart = null; });
canvas.addEventListener('mouseleave',() => { isPanning = false; panStart = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx   = e.clientX - rect.left;
  const sy   = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 0.88;
  VIEW.offsetX = sx + (VIEW.offsetX - sx) * factor;
  VIEW.offsetY = sy + (VIEW.offsetY - sy) * factor;
  VIEW.scale  *= factor;
  VIEW.scale   = Math.max(10, Math.min(VIEW.scale, 400));
  draw();
}, { passive: false });

// ── HIT TESTING ────────────────────────────────────────────────────────────────
function hitTestNode(sx, sy) {
  for (const n of state.nodes) {
    const p = worldToScreen(n.x, n.y);
    if (Math.hypot(p.sx - sx, p.sy - sy) <= 10) return n.id;
  }
  return null;
}

function hitTestMember(sx, sy) {
  for (const m of state.members) {
    const ni = state.nodes.find(n => n.id === m.i);
    const nj = state.nodes.find(n => n.id === m.j);
    if (!ni || !nj) continue;
    const pi = worldToScreen(ni.x, ni.y);
    const pj = worldToScreen(nj.x, nj.y);
    if (distToSegment(sx, sy, pi.sx, pi.sy, pj.sx, pj.sy) < 8) return m.id;
  }
  return null;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t  = Math.max(0, Math.min(1, ((px - ax)*dx + (py - ay)*dy) / (dx*dx + dy*dy)));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

// ── STATE MUTATIONS ────────────────────────────────────────────────────────────
function addNode(x, y) {
  state.nodes.push({ id: state.nextNodeId++, x, y, support: null, forces: [] });
  updateLists();
}

function addMember(idI, idJ) {
  // Prevent duplicate
  const exists = state.members.some(m =>
    (m.i === idI && m.j === idJ) || (m.i === idJ && m.j === idI)
  );
  if (exists) return;
  state.members.push({ id: state.nextMemberId++, i: idI, j: idJ });
  updateLists();
}

function deleteSelected() {
  if (!state.selected) return;
  if (state.selected.type === 'node') {
    const id = state.selected.id;
    state.nodes    = state.nodes.filter(n => n.id !== id);
    state.members  = state.members.filter(m => m.i !== id && m.j !== id);
  } else {
    state.members  = state.members.filter(m => m.id !== state.selected.id);
  }
  state.selected = null;
  state.analysisResult = null;
  updateLists(); draw();
}

function clearAll() {
  if (!confirm('Clear all nodes and members?')) return;
  state.nodes = []; state.members = [];
  state.selected = null; state.memberStart = null;
  state.analysisResult = null;
  state.nextNodeId = 0; state.nextMemberId = 0;
  document.getElementById('canvas-hint').classList.remove('hidden');
  updateLists(); draw();
}

// ── TOOL SELECTION ─────────────────────────────────────────────────────────────
function setTool(tool) {
  state.tool = tool;
  state.memberStart = null;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-${tool}`)?.classList.add('active');

  const hints = {
    select:  'Click a node or member to select it',
    node:    'Click anywhere on the canvas to place a node',
    member:  'Click first node, then second node to create a member',
    support: 'Click a node to assign a support condition',
    force:   'Click a node to assign an external force',
  };
  const hint = document.getElementById('canvas-hint');
  hint.textContent = hints[tool] || '';
  if (state.nodes.length > 0) hint.classList.add('hidden');
  draw();
}

// ── POPUPS ─────────────────────────────────────────────────────────────────────
function openSupportPopup(nodeId) {
  state.activePopupNode = nodeId;
  const idx = state.nodes.findIndex(n => n.id === nodeId);
  document.getElementById('support-node-id').textContent = idx;
  showPopup('popup-support');
}

function setSupport(type) {
  const n = state.nodes.find(n => n.id === state.activePopupNode);
  if (n) n.support = type === 'free' ? null : type;
  closePopup('popup-support');
  updateLists(); draw();
}

function openForcePopup(nodeId) {
  state.activePopupNode = nodeId;
  const idx = state.nodes.findIndex(n => n.id === nodeId);
  document.getElementById('force-node-id').textContent = idx;
  document.getElementById('force-mag').value   = 10;
  document.getElementById('force-angle').value = 270;
  updateForcePreview();
  renderForceList(nodeId);
  showPopup('popup-force');
}

function renderForceList(nodeId) {
  const n = state.nodes.find(n => n.id === nodeId);
  const container = document.getElementById('force-list-container');
  if (!n || !n.forces || n.forces.length === 0) {
    container.innerHTML = '<div class="force-list-empty">No forces added yet</div>';
    return;
  }
  container.innerHTML = n.forces.map((f, i) => {
    const rad = f.angle * Math.PI / 180;
    const fx  = (f.mag * Math.cos(rad)).toFixed(2);
    const fy  = (f.mag * Math.sin(rad)).toFixed(2);
    return `<div class="force-list-item">
      <span>${f.mag}kN @ ${f.angle}° &nbsp;(Fx=${fx}, Fy=${fy})</span>
      <button onclick="removeForceAt(${nodeId}, ${i})">✕</button>
    </div>`;
  }).join('');
}

function updateForcePreview() {
  const mag   = +document.getElementById('force-mag').value;
  const angle = +document.getElementById('force-angle').value;
  const rad   = angle * Math.PI / 180;
  const fx    = (mag * Math.cos(rad)).toFixed(3);
  const fy    = (mag * Math.sin(rad)).toFixed(3);
  document.getElementById('force-preview').textContent =
    `Fx = ${fx} kN\nFy = ${fy} kN`;
}
document.getElementById('force-mag').addEventListener('input', updateForcePreview);
document.getElementById('force-angle').addEventListener('input', updateForcePreview);

function applyForce() {
    const mag = +document.getElementById('force-mag').value;
    const angle = +document.getElementById('force-angle').value;
    if (mag <= 0) {
        alert('Magnitude must be greater than 0.');
        return;
    }
    const n = state.nodes.find(n => n.id === state.activePopupNode);
    if (n) {
        if (!n.forces) n.forces = [];
        n.forces.push({mag, angle});
    }

    renderForceList(state.activePopupNode);
    updateLists();
    draw();

    document.getElementById('force-mag').value = 10;
    document.getElementById('force-angle').value = 270;
    updateForcePreview();
}

function removeForce() {
  const n = state.nodes.find(n => n.id === state.activePopupNode);
  if (n) n.forces = [];
  renderForceList(state.activePopupNode);
  updateLists(); draw();
}

function removeForceAt(nodeId, index) {
  const n = state.nodes.find(n => n.id === nodeId);
  if (n && n.forces) {
    n.forces.splice(index, 1);
    renderForceList(nodeId);
    updateLists(); draw();
  }
}

function showPopup(id) {
  document.getElementById(id).style.display    = 'flex';
  document.getElementById('overlay').style.display = 'block';
}
function closePopup(id) {
  document.getElementById(id).style.display    = 'none';
  document.getElementById('overlay').style.display = 'none';
}
function closeAllPopups() {
  ['popup-support', 'popup-force'].forEach(id => closePopup(id));
}

// ── SIDEBAR LISTS ──────────────────────────────────────────────────────────────
function updateLists() {
  document.getElementById('count-nodes').textContent   = state.nodes.length;
  document.getElementById('count-members').textContent = state.members.length;

  const nl = document.getElementById('list-nodes');
  nl.innerHTML = state.nodes.map((n, i) => {
    const badges = [];
    if (n.support) badges.push(`<span class="list-item-badge badge-pin">${n.support}</span>`);
    if (n.forces && n.forces.length > 0) {
      badges.push(`<span class="list-item-badge badge-force">${n.forces.length} force(s)</span>`);
    }
    return `<div class="list-item" onclick="selectNode(${n.id})">
      <span>N${i} (${n.x}, ${n.y})</span>
      <span>${badges.join('')}</span>
    </div>`;
  }).join('');

  const ml = document.getElementById('list-members');
  ml.innerHTML = state.members.map((m, i) => {
    const ni = state.nodes.findIndex(n => n.id === m.i);
    const nj = state.nodes.findIndex(n => n.id === m.j);
    return `<div class="list-item" onclick="selectMember(${m.id})">
      <span>E${i}: N${ni}→N${nj}</span>
    </div>`;
  }).join('');
}

function selectNode(id)   { state.selected = { type: 'node',   id }; draw(); }
function selectMember(id) { state.selected = { type: 'member', id }; draw(); }

// ── ANALYSIS ──────────────────────────────────────────────────────────────────
async function runAnalysis() {
  if (state.nodes.length < 2)   { alert('Need at least 2 nodes.'); return; }
  if (state.members.length < 1) { alert('Need at least 1 member.'); return; }

  const E   = +document.getElementById('mat-E').value * 1e9;
  const A   = +document.getElementById('mat-A').value * 1e-4;
  const g   = +document.getElementById('sw-g').value;
  const rho = +document.getElementById('sw-rho').value;
  const sw  = document.getElementById('sw-toggle').checked;

  const forces = {};
  const bcs    = {};

  state.nodes.forEach((n, idx) => {
    if (n.forces && n.forces.length > 0) {
      let totalFx = 0, totalFy = 0;
      n.forces.forEach(f => {
        const rad = f.angle * Math.PI / 180;
        totalFx  += f.mag * Math.cos(rad) * 1e3;   // kN → N
        totalFy  += f.mag * Math.sin(rad) * 1e3;
      });
      if (Math.abs(totalFx) > 1e-10 || Math.abs(totalFy) > 1e-10) {
        forces[idx] = { fx: totalFx, fy: totalFy };
      }
    }
    if (n.support === 'pin')      bcs[idx] = { fix_x: true,  fix_y: true  };
    if (n.support === 'roller')   bcs[idx] = { fix_x: false, fix_y: true  };
    if (n.support === 'roller-x') bcs[idx] = { fix_x: true,  fix_y: false };
  });

  const payload = {
    nodes:    state.nodes.map(n => ({ x: n.x, y: n.y })),
    elements: state.members.map(m => ({
      i: state.nodes.findIndex(n => n.id === m.i),
      j: state.nodes.findIndex(n => n.id === m.j),
    })),
    E, A,
    forces,
    boundary_conditions: bcs,
    include_self_weight: sw,
    gravity: g,
    density: rho,
  };

  const btn = document.querySelector('.run-btn');
  btn.textContent = '⏳ Analyzing...';
  btn.disabled = true;

  try {
    const resp = await fetch(`${API}/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();

    if (!data.success) {
      alert(`Analysis failed:\n${data.message}`);
      return;
    }

    state.analysisResult = data;
    showResults(data);
    draw();
  } catch (err) {
    alert('Cannot connect to backend.\nMake sure api.py is running.\n\n' + err.message);
  } finally {
    btn.textContent = '▶ Run Analysis';
    btn.disabled = false;
  }
}

function showResults(data) {
  document.getElementById('results-placeholder').style.display = 'none';
  document.getElementById('results-content').style.display     = 'block';

  // Axial forces table
  document.querySelector('#tbl-forces tbody').innerHTML =
    data.element_results.map(r => {
      const isZero = r.force_kN < 0.001;
      const cls    = isZero ? 'zero-force' : (r.type === 'Compression' ? 'compression' : 'tension');
      const label  = isZero ? 'Zero-force' : r.type;
      const val    = isZero ? '—' : r.force_kN.toFixed(3);
      return `<tr>
        <td>E${r.element_id}</td>
        <td class="${cls}">${val}</td>
        <td class="${cls}">${label}</td>
      </tr>`;
    }).join('');

  // Displacements table
  document.querySelector('#tbl-disp tbody').innerHTML =
    data.displacements.map(d =>
      `<tr><td>N${d.node_id}</td><td>${d.ux_mm.toFixed(4)}</td><td>${d.uy_mm.toFixed(4)}</td></tr>`
    ).join('');

  // Reactions table
  document.querySelector('#tbl-react tbody').innerHTML =
    data.reactions.map(r =>
      `<tr><td>N${r.node_id}</td><td>${r.rx_kN.toFixed(3)}</td><td>${r.ry_kN.toFixed(3)}</td></tr>`
    ).join('');

  // Equilibrium
  const okX = Math.abs(data.equilibrium_fx) < 0.01;
  const okY = Math.abs(data.equilibrium_fy) < 0.01;
  document.getElementById('eq-bar').innerHTML =
    `ΣFx = <span class="${okX ? 'eq-ok' : 'eq-warn'}">${data.equilibrium_fx.toFixed(4)} kN</span><br>
     ΣFy = <span class="${okY ? 'eq-ok' : 'eq-warn'}">${data.equilibrium_fy.toFixed(4)} kN</span>
     &nbsp;— should be ≈ 0`;
}

// ── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const map = { s: 'select', n: 'node', m: 'member', p: 'support', f: 'force' };
  if (map[e.key]) setTool(map[e.key]);
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'Escape') { state.memberStart = null; draw(); }
});

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();