/**
 * arena.js — Draws level-specific arena layouts.
 *
 * Layouts:
 *  'open'     — Clean arena floor with perimeter walls hinted in darkness
 *  'corridor' — A narrow horizontal gauntlet
 *  'defend'   — Central objective room with approach corridors
 *  'ruins'    — Rubble obstacles breaking up movement
 *
 * Each layout also exports a getSpawnPoints(layout, W, H) helper that
 * returns where enemies should spawn for that layout type.
 */

// ─── Tile pattern cache ────────────────────────────────────────────────────────

let _floorPattern  = null;
let _dangerPattern = null;

function _buildFloorTile(ctx, size = 64, color1 = '#0a120a', color2 = 'rgba(255,255,255,0.025)') {
    const oc = document.createElement('canvas');
    oc.width = oc.height = size;
    const c = oc.getContext('2d');
    c.fillStyle = color1;
    c.fillRect(0, 0, size, size);
    c.strokeStyle = color2;
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, size - 1, size - 1);
    // Subtle diagonal crack on some tiles
    if (Math.random() > 0.6) {
        c.strokeStyle = 'rgba(255,255,255,0.015)';
        c.lineWidth   = 0.5;
        c.beginPath();
        c.moveTo(Math.random()*size*0.4, Math.random()*size*0.4);
        c.lineTo(size*0.5+Math.random()*size*0.4, size*0.5+Math.random()*size*0.4);
        c.stroke();
    }
    return oc;
}

export function buildPatterns(ctx) {
    const tile   = _buildFloorTile(ctx);
    _floorPattern = ctx.createPattern(tile, 'repeat');

    const dangerTile = _buildFloorTile(ctx, 64, '#0e0808', 'rgba(200,40,40,0.04)');
    _dangerPattern = ctx.createPattern(dangerTile, 'repeat');
}

// ─── Wall / obstacle drawing primitives ───────────────────────────────────────

function drawWall(ctx, x, y, w, h) {
    ctx.fillStyle = '#111c11';
    ctx.fillRect(x, y, w, h);
    // Top highlight
    ctx.fillStyle = 'rgba(100,200,100,0.06)';
    ctx.fillRect(x, y, w, 3);
    // Right shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x + w - 3, y, 3, h);
    // Border
    ctx.strokeStyle = 'rgba(76,175,80,0.15)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHazardZone(ctx, x, y, w, h) {
    ctx.fillStyle = _dangerPattern || 'rgba(180,30,0,0.07)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,60,0,0.2)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
}

function drawObjectiveMarker(ctx, x, y, label = 'CACHE', health = 1) {
    const r = 22;
    // Glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
    grd.addColorStop(0, `rgba(255,193,7,${0.15 * health})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle   = health > 0.5 ? '#1a2e1a' : health > 0.25 ? '#2e1a00' : '#2e0000';
    ctx.strokeStyle = health > 0.5 ? '#ffb300' : health > 0.25 ? '#ff6d00' : '#f44336';
    ctx.lineWidth   = 2.5;
    ctx.fill();
    ctx.stroke();

    // Icon (simple box shape)
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(x - 9, y - 7, 18, 14);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 4, y - 3, 8, 6);

    // Label
    ctx.font        = 'bold 9px "Share Tech Mono", monospace';
    ctx.fillStyle   = '#ffb300';
    ctx.textAlign   = 'center';
    ctx.fillText(label, x, y + r + 14);

    // Health arc
    const startA = -Math.PI / 2;
    const endA   = startA + Math.PI * 2 * health;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, startA, endA);
    ctx.strokeStyle = health > 0.5 ? '#ffb300' : health > 0.25 ? '#ff6d00' : '#f44336';
    ctx.lineWidth   = 3;
    ctx.stroke();
}

// ─── Layout renderers ─────────────────────────────────────────────────────────

function drawOpen(ctx, W, H) {
    // Full floor fill
    ctx.fillStyle = _floorPattern || '#0a120a';
    ctx.fillRect(0, 0, W, H);

    // Subtle perimeter darkening (arena feel)
    const marg = 48;
    const grad = ctx.createLinearGradient(0, 0, marg, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, marg, H);
    const gr2 = ctx.createLinearGradient(W, 0, W - marg, 0);
    gr2.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr2; ctx.fillRect(W - marg, 0, marg, H);
    const gt = ctx.createLinearGradient(0, 0, 0, marg);
    gt.addColorStop(0, 'rgba(0,0,0,0.55)');
    gt.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gt; ctx.fillRect(0, 0, W, marg);
    const gb = ctx.createLinearGradient(0, H, 0, H - marg);
    gb.addColorStop(0, 'rgba(0,0,0,0.55)');
    gb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gb; ctx.fillRect(0, H - marg, W, marg);
}

function drawCorridor(ctx, W, H) {
    // Full dark background (outside corridor)
    ctx.fillStyle = '#030603';
    ctx.fillRect(0, 0, W, H);

    const wallH = Math.round(H * 0.28);
    const corridorY = wallH;
    const corridorH = H - wallH * 2;

    // Wall blocks
    drawWall(ctx, 0, 0, W, wallH);
    drawWall(ctx, 0, H - wallH, W, wallH);

    // Corridor floor
    ctx.fillStyle = _floorPattern || '#0a120a';
    ctx.fillRect(0, corridorY, W, corridorH);

    // Inner wall edge glow
    ctx.fillStyle = 'rgba(76,175,80,0.06)';
    ctx.fillRect(0, corridorY, W, 4);
    ctx.fillRect(0, corridorY + corridorH - 4, W, 4);

    // Centre line dashes
    ctx.strokeStyle = 'rgba(76,175,80,0.08)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([20, 15]);
    ctx.beginPath();
    ctx.moveTo(0,   H / 2);
    ctx.lineTo(W,   H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawDefend(ctx, W, H, objectivePos, objectiveHealth) {
    // Base floor
    ctx.fillStyle = _floorPattern || '#0a120a';
    ctx.fillRect(0, 0, W, H);

    // Perimeter darkening
    drawOpen(ctx, W, H);

    // Approach corridors — draw hazard zones to hint pressure directions
    const cx = W / 2, cy = H / 2;

    // Decorative defence ring
    ctx.beginPath();
    ctx.arc(cx, cy, 130, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,193,7,0.08)';
    ctx.lineWidth   = 40;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 130, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,193,7,0.12)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Objective
    drawObjectiveMarker(ctx, objectivePos.x, objectivePos.y, 'CACHE', objectiveHealth);
}

function drawRuins(ctx, W, H, obstacles) {
    // Base
    ctx.fillStyle = _floorPattern || '#0a120a';
    ctx.fillRect(0, 0, W, H);
    drawOpen(ctx, W, H);

    // Rubble blocks
    if (obstacles) {
        for (const ob of obstacles) {
            drawWall(ctx, ob.x, ob.y, ob.w, ob.h);
            // Scattered rubble dots around each block
            ctx.fillStyle = 'rgba(100,140,100,0.07)';
            for (let i = 0; i < 6; i++) {
                const rx = ob.x + Math.random() * ob.w;
                const ry = ob.y + Math.random() * ob.h;
                ctx.beginPath();
                ctx.arc(rx, ry, 2 + Math.random() * 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

// ─── Main draw function ───────────────────────────────────────────────────────

export function drawArena(ctx, W, H, layoutType, extra = {}) {
    switch (layoutType) {
        case 'corridor': drawCorridor(ctx, W, H);                               break;
        case 'defend':   drawDefend(ctx, W, H, extra.objectivePos, extra.objectiveHealth); break;
        case 'ruins':    drawRuins(ctx, W, H, extra.obstacles);                 break;
        default:         drawOpen(ctx, W, H);                                   break;
    }
}

// ─── Spawn point generator ────────────────────────────────────────────────────

export function getSpawnPoints(layoutType, W, H) {
    switch (layoutType) {
        case 'corridor': {
            // Spawn only from left/right edges within the corridor band
            const wallH  = Math.round(H * 0.28);
            const corrY  = wallH;
            const corrH  = H - wallH * 2;
            const side   = Math.random() < 0.5 ? 0 : 1;
            const ex     = side === 0 ? -24 : W + 24;
            const ey     = corrY + Math.random() * corrH;
            return { x: ex, y: ey };
        }
        case 'defend':
        case 'ruins':
        case 'open':
        default: {
            const side = Math.floor(Math.random() * 4);
            switch (side) {
                case 0: return { x: Math.random() * W, y: -24 };
                case 1: return { x: W + 24,            y: Math.random() * H };
                case 2: return { x: Math.random() * W, y: H + 24 };
                default:return { x: -24,               y: Math.random() * H };
            }
        }
    }
}

// ─── Obstacles generator (used by 'ruins' layout) ────────────────────────────

export function generateObstacles(W, H) {
    const blocks = [];
    const placements = [
        // Left cluster
        { x: 0.12, y: 0.25, w: 0.06, h: 0.12 },
        { x: 0.12, y: 0.62, w: 0.05, h: 0.10 },
        // Right cluster
        { x: 0.82, y: 0.30, w: 0.06, h: 0.10 },
        { x: 0.80, y: 0.60, w: 0.07, h: 0.12 },
        // Middle obstacles
        { x: 0.38, y: 0.18, w: 0.05, h: 0.08 },
        { x: 0.55, y: 0.72, w: 0.05, h: 0.08 },
        // Flanking pillars
        { x: 0.28, y: 0.44, w: 0.04, h: 0.04 },
        { x: 0.66, y: 0.44, w: 0.04, h: 0.04 },
    ];
    for (const p of placements) {
        blocks.push({ x: p.x*W, y: p.y*H, w: p.w*W, h: p.h*H });
    }
    return blocks;
}