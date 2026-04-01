/**
 * enemy.js — Enemy types for Zombie Survival Arena.
 *
 * CHANGES:
 *  - Zombie: damage 10→20, INSTANT attack on contact (no timer delay),
 *            attack rate tightened to 800ms
 *  - Runner: faster (195→240 chase), more aggressive zigzag, more HP (40→55),
 *            damage buffed 7→14, smaller attack timer gap
 *  - Brute:  damage 25→60, knockback further, slightly faster
 *  - Spitter: unchanged (ranged, already punishing)
 */

import { FSM }   from './fsm.js';
import { Audio } from './audio.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function pickWanderTarget(margin = 80, arenaConstraint = null) {
    if (arenaConstraint) {
        const { x, y, w, h } = arenaConstraint;
        return {
            x: x + margin + Math.random() * (w - margin * 2),
            y: y + margin + Math.random() * (h - margin * 2),
        };
    }
    const canvas = document.getElementById('gameCanvas');
    const W = canvas ? canvas.width  : 800;
    const H = canvas ? canvas.height : 600;
    return {
        x: margin + Math.random() * (W - margin * 2),
        y: margin + Math.random() * (H - margin * 2),
    };
}

function moveToward(entity, target, speed, delta) {
    const dx   = target.x - entity.x;
    const dy   = target.y - entity.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const s = (speed * delta) / 1000;
    entity.x += (dx / dist) * s;
    entity.y += (dy / dist) * s;
}

// ─────────────────────────────────────────────────────────────────────────────
//  AcidBlob  — Spitter projectile
// ─────────────────────────────────────────────────────────────────────────────

export class AcidBlob {
    constructor(x, y, targetX, targetY) {
        const angle = Math.atan2(targetY - y, targetX - x)
                    + (Math.random() - 0.5) * 0.25;
        const spd   = 190 + Math.random() * 40;
        this.x  = x;
        this.y  = y;
        this.vx = Math.cos(angle) * spd;
        this.vy = Math.sin(angle) * spd;
        this.radius = 6;
        this.damage = 8;
        this.dead   = false;
        this.age    = 0;
        this.life   = 2800;
        this.trail  = [];
    }

    update(delta) {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 5) this.trail.shift();
        this.x   += this.vx * delta / 1000;
        this.y   += this.vy * delta / 1000;
        this.age += delta;
        if (this.age >= this.life) this.dead = true;
    }

    draw(ctx) {
        for (let i = 0; i < this.trail.length; i++) {
            const t = i / this.trail.length;
            ctx.beginPath();
            ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * t * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(100, 230, 60, ${t * 0.4})`;
            ctx.fill();
        }
        const pulse = 0.85 + 0.15 * Math.sin(this.age / 80);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle   = '#76ff03';
        ctx.shadowColor = '#64dd17';
        ctx.shadowBlur  = 14;
        ctx.fill();
        ctx.shadowBlur  = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared SPAWN + DEAD state builder
// ─────────────────────────────────────────────────────────────────────────────

const SPAWN_DURATION = 600;

function buildBaseStates(enemy, chaseStates) {
    return {
        SPAWN: {
            onEnter() { enemy.alpha = 0; },
            onUpdate() {
                enemy.alpha = Math.min(1, enemy.fsm.getTimeInState() / SPAWN_DURATION);
            },
            transitions: [
                { to: 'WANDER', condition: () => enemy.fsm.getTimeInState() >= SPAWN_DURATION },
            ],
        },
        DEAD: {
            onEnter() {
                enemy.alpha      = 1;
                enemy.dead       = false;
                enemy.deathTimer = 0;
                document.dispatchEvent(new CustomEvent('enemyDied', {
                    detail: { enemy, scoreBonus: enemy.scoreBonus ?? 100 },
                }));
                Audio.death();
            },
            onUpdate(ctx) {
                enemy.deathTimer += ctx.delta;
                enemy.alpha = Math.max(0, 1 - enemy.deathTimer / 500);
                if (enemy.deathTimer >= 500) enemy.dead = true;
            },
            transitions: [],
        },
        ...chaseStates,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ZOMBIE  — buffed: 20 dmg, INSTANT first hit, 800ms repeat rate
// ─────────────────────────────────────────────────────────────────────────────

const ZC = {
    CHASE_RANGE:   420,
    FORGET_RANGE:  600,
    ATTACK_RANGE:  32,
    WANDER_SPEED:  48,
    CHASE_SPEED:   95,
    ATTACK_DAMAGE: 20,   // was 10
    ATTACK_RATE:   800,  // was 1000
    MAX_HEALTH:    100,
    RADIUS:        14,
    SCORE:         100,
};

function buildZombieStates(e) {
    return buildBaseStates(e, {
        WANDER: {
            onEnter() { e.wanderTarget = pickWanderTarget(); },
            onUpdate(ctx) {
                moveToward(e, e.wanderTarget, ZC.WANDER_SPEED, ctx.delta);
                if (Math.hypot(e.x-e.wanderTarget.x, e.y-e.wanderTarget.y) < 8) e.wanderTarget = pickWanderTarget();
            },
            transitions: [
                { to:'CHASE', condition:(ctx)=>ctx.player && e.distanceTo(ctx.player)<ZC.CHASE_RANGE },
                { to:'DEAD',  condition:()=>e.health<=0 },
            ],
        },
        CHASE: {
            onEnter(){},
            onUpdate(ctx) { if(ctx.player) moveToward(e, ctx.player, ZC.CHASE_SPEED*e.speedMult, ctx.delta); },
            transitions: [
                { to:'ATTACK', condition:(ctx)=>ctx.player && e.distanceTo(ctx.player)<ZC.ATTACK_RANGE },
                { to:'WANDER', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>ZC.FORGET_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
        ATTACK: {
            // INSTANT first strike: attackTimer starts at ATTACK_RATE so first tick fires immediately
            onEnter() { e.attackTimer = ZC.ATTACK_RATE; },
            onUpdate(ctx) {
                if(ctx.player) moveToward(e, ctx.player, ZC.CHASE_SPEED*e.speedMult, ctx.delta);
                e.attackTimer += ctx.delta;
                if(e.attackTimer >= ZC.ATTACK_RATE){
                    e.attackTimer = 0;
                    if(ctx.player) ctx.player.takeDamage(ZC.ATTACK_DAMAGE);
                }
            },
            transitions: [
                { to:'CHASE', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>=ZC.ATTACK_RANGE },
                { to:'DEAD',  condition:()=>e.health<=0 },
            ],
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  RUNNER  — faster, more erratic, 14 dmg, instant first hit
// ─────────────────────────────────────────────────────────────────────────────

const RC = {
    CHASE_RANGE:   520,
    FORGET_RANGE:  750,
    ATTACK_RANGE:  24,
    WANDER_SPEED:  90,
    CHASE_SPEED:   240,  // was 195
    ATTACK_DAMAGE: 14,   // was 7
    ATTACK_RATE:   600,  // was 700
    MAX_HEALTH:    55,   // was 40
    RADIUS:        9,
    SCORE:         150,
    ZIG_PERIOD:    320,  // tighter zigzag cycle (was 420)
    ZIG_AMP:       70,   // wider sweep (was 55)
};

function buildRunnerStates(e) {
    return buildBaseStates(e, {
        WANDER: {
            onEnter() { e.wanderTarget = pickWanderTarget(); },
            onUpdate(ctx) {
                moveToward(e, e.wanderTarget, RC.WANDER_SPEED, ctx.delta);
                if (Math.hypot(e.x-e.wanderTarget.x, e.y-e.wanderTarget.y) < 8) e.wanderTarget = pickWanderTarget();
            },
            transitions: [
                { to:'CHASE', condition:(ctx)=>ctx.player&&e.distanceTo(ctx.player)<RC.CHASE_RANGE },
                { to:'DEAD',  condition:()=>e.health<=0 },
            ],
        },
        CHASE: {
            onEnter() { e.zigTimer=0; },
            onUpdate(ctx) {
                if(!ctx.player) return;
                e.zigTimer += ctx.delta;
                const dx=ctx.player.x-e.x, dy=ctx.player.y-e.y, dist=Math.hypot(dx,dy)||1;
                const perp={x:-dy/dist, y:dx/dist};
                const zig=Math.sin((e.zigTimer/RC.ZIG_PERIOD)*Math.PI*2)*RC.ZIG_AMP;
                moveToward(e, {x:ctx.player.x+perp.x*zig, y:ctx.player.y+perp.y*zig}, RC.CHASE_SPEED*e.speedMult, ctx.delta);
            },
            transitions: [
                { to:'ATTACK', condition:(ctx)=>ctx.player&&e.distanceTo(ctx.player)<RC.ATTACK_RANGE },
                { to:'WANDER', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>RC.FORGET_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
        ATTACK: {
            onEnter() { e.attackTimer = RC.ATTACK_RATE; },  // instant first hit
            onUpdate(ctx) {
                if(ctx.player) moveToward(e, ctx.player, RC.CHASE_SPEED*e.speedMult, ctx.delta);
                e.attackTimer += ctx.delta;
                if(e.attackTimer>=RC.ATTACK_RATE){ e.attackTimer=0; if(ctx.player) ctx.player.takeDamage(RC.ATTACK_DAMAGE); }
            },
            transitions: [
                { to:'CHASE', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>=RC.ATTACK_RANGE },
                { to:'DEAD',  condition:()=>e.health<=0 },
            ],
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  BRUTE  — 60 dmg, huge knockback, slightly faster
// ─────────────────────────────────────────────────────────────────────────────

const BC = {
    CHASE_RANGE:    400,
    FORGET_RANGE:   560,
    ATTACK_RANGE:   50,
    WANDER_SPEED:   28,
    CHASE_SPEED:    60,   // was 52
    ATTACK_DAMAGE:  60,   // was 25
    KNOCKBACK_DIST: 180,  // was 120
    ATTACK_RATE:    1600,
    MAX_HEALTH:     280,
    RADIUS:         24,
    SCORE:          300,
};

function buildBruteStates(e) {
    return buildBaseStates(e, {
        WANDER: {
            onEnter() { e.wanderTarget = pickWanderTarget(120); },
            onUpdate(ctx) {
                moveToward(e, e.wanderTarget, BC.WANDER_SPEED, ctx.delta);
                if (Math.hypot(e.x-e.wanderTarget.x, e.y-e.wanderTarget.y) < 12) e.wanderTarget = pickWanderTarget(120);
            },
            transitions: [
                { to:'CHARGE', condition:(ctx)=>ctx.player&&e.distanceTo(ctx.player)<BC.CHASE_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
        CHARGE: {
            onEnter() { e.chargeTimer=0; },
            onUpdate(ctx) {
                if(ctx.player) moveToward(e, ctx.player, BC.CHASE_SPEED*e.speedMult, ctx.delta);
                e.chargeTimer += ctx.delta;
            },
            transitions: [
                { to:'SLAM',   condition:(ctx)=>ctx.player&&e.distanceTo(ctx.player)<BC.ATTACK_RANGE },
                { to:'WANDER', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>BC.FORGET_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
        SLAM: {
            onEnter() { e.attackTimer=BC.ATTACK_RATE*0.7; e.slamWarned=true; }, // near-instant first slam
            onUpdate(ctx) {
                e.attackTimer += ctx.delta;
                if(e.attackTimer >= BC.ATTACK_RATE){
                    e.attackTimer=0; e.slamWarned=false;
                    if(ctx.player){
                        ctx.player.takeDamage(BC.ATTACK_DAMAGE);
                        const dx=ctx.player.x-e.x, dy=ctx.player.y-e.y, dist=Math.hypot(dx,dy)||1;
                        ctx.player.applyKnockback((dx/dist)*BC.KNOCKBACK_DIST, (dy/dist)*BC.KNOCKBACK_DIST);
                    }
                    setTimeout(() => { e.slamWarned = true; }, 200);
                }
            },
            transitions: [
                { to:'CHARGE', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>=BC.ATTACK_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SPITTER (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const SPC = { DETECT_RANGE:480, PREFERRED_DIST:280, RETREAT_DIST:160, FORGET_RANGE:700, WANDER_SPEED:35, MOVE_SPEED:70, FIRE_RATE:2200, MAX_HEALTH:70, RADIUS:12, SCORE:200 };

function buildSpitterStates(e) {
    return buildBaseStates(e, {
        WANDER: {
            onEnter() { e.wanderTarget = pickWanderTarget(); },
            onUpdate(ctx) {
                moveToward(e, e.wanderTarget, SPC.WANDER_SPEED, ctx.delta);
                if (Math.hypot(e.x-e.wanderTarget.x, e.y-e.wanderTarget.y) < 8) e.wanderTarget = pickWanderTarget();
            },
            transitions: [
                { to:'REPOSITION', condition:(ctx)=>ctx.player&&e.distanceTo(ctx.player)<SPC.DETECT_RANGE },
                { to:'DEAD',       condition:()=>e.health<=0 },
            ],
        },
        REPOSITION: {
            onEnter() { e.fireTimer = SPC.FIRE_RATE * 0.5; },
            onUpdate(ctx) {
                if(!ctx.player) return;
                const dist = e.distanceTo(ctx.player);
                if(dist < SPC.RETREAT_DIST){
                    const dx=e.x-ctx.player.x, dy=e.y-ctx.player.y, mag=Math.hypot(dx,dy)||1;
                    e.x += (dx/mag)*SPC.MOVE_SPEED*e.speedMult*ctx.delta/1000;
                    e.y += (dy/mag)*SPC.MOVE_SPEED*e.speedMult*ctx.delta/1000;
                } else if(dist > SPC.PREFERRED_DIST){
                    moveToward(e, ctx.player, SPC.MOVE_SPEED*e.speedMult, ctx.delta);
                }
                e.fireTimer += ctx.delta;
                if(e.fireTimer >= SPC.FIRE_RATE){
                    e.fireTimer=0;
                    e.projectiles.push(new AcidBlob(e.x, e.y, ctx.player.x, ctx.player.y));
                }
            },
            transitions: [
                { to:'WANDER', condition:(ctx)=>!ctx.player||e.distanceTo(ctx.player)>SPC.FORGET_RANGE },
                { to:'DEAD',   condition:()=>e.health<=0 },
            ],
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  EnemyBase — shared logic
// ─────────────────────────────────────────────────────────────────────────────

class EnemyBase {
    constructor(x, y, speedMult, cfg, stateBuilder) {
        this.x          = x;
        this.y          = y;
        this.radius     = cfg.RADIUS;
        this.health     = cfg.MAX_HEALTH;
        this.maxHealth  = cfg.MAX_HEALTH;
        this.speedMult  = Math.min(speedMult, 2.2);
        this.scoreBonus = cfg.SCORE;
        this.alpha      = 0;
        this.dead       = false;
        this.attackTimer = 0;
        this.deathTimer  = 0;
        this.wanderTarget = { x, y };
        this.projectiles  = [];

        this.fsm = new FSM('SPAWN', stateBuilder(this));
    }

    update(player, delta) {
        if (this.dead) return;
        for (const p of this.projectiles) p.update(delta);
        this.projectiles = this.projectiles.filter(p => !p.dead);
        this.fsm.update({ player, delta }, delta);
    }

    distanceTo(target) {
        return Math.hypot(this.x - target.x, this.y - target.y);
    }

    takeDamage(amount) {
        if (this.fsm.isIn('DEAD')) return;
        this.health = Math.max(0, this.health - amount);
        Audio.hit();
        if (this.health <= 0) this.fsm.forceTransition('DEAD');
    }

    _drawCommon(ctx) {
        if (this.health < this.maxHealth && !this.fsm.isIn('SPAWN', 'DEAD')) {
            const barW = this.radius * 2 + 4, barH = 4;
            const bx = this.x - barW / 2, by = this.y - this.radius - 10;
            ctx.fillStyle = '#222';
            ctx.fillRect(bx, by, barW, barH);
            const pct = this.health / this.maxHealth;
            ctx.fillStyle = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ff9800' : '#f44336';
            ctx.fillRect(bx, by, barW * pct, barH);
        }
        if (window.DEBUG_FSM) {
            ctx.fillStyle = 'white';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(this.fsm.getState(), this.x, this.y - this.radius - 14);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Concrete types
// ─────────────────────────────────────────────────────────────────────────────

export class Zombie extends EnemyBase {
    constructor(x, y, speedMult = 1) {
        super(x, y, speedMult, ZC, buildZombieStates);
        this.type = 'zombie';
    }
    draw(ctx) {
        if (this.dead) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        const state = this.fsm.getState();
        const bodyColor = state==='ATTACK' ? '#c62828' : state==='CHASE' ? '#8d6e1a' : '#4a7c4a';

        ctx.beginPath();
        ctx.ellipse(this.x, this.y+this.radius-2, this.radius*0.8, this.radius*0.3, 0, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fillStyle=bodyColor; ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1.5; ctx.stroke();

        const eo = this.radius*0.35;
        for(const ex of [-eo*0.6, eo*0.6]){
            ctx.beginPath(); ctx.arc(this.x+ex, this.y-eo*0.4, 2.2, 0, Math.PI*2);
            ctx.fillStyle = state==='ATTACK' ? '#ff1744' : '#ef9a9a'; ctx.fill();
        }
        this._drawCommon(ctx);
        ctx.restore();
    }
}

export class Runner extends EnemyBase {
    constructor(x, y, speedMult = 1) {
        super(x, y, speedMult, RC, buildRunnerStates);
        this.type='runner'; this.zigTimer=0; this._bobTime=Math.random()*Math.PI*2;
    }
    draw(ctx) {
        if (this.dead) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        this._bobTime += 0.25; // faster bob to match speed
        const bob = Math.sin(this._bobTime)*2.2;
        const state = this.fsm.getState();

        ctx.beginPath();
        ctx.ellipse(this.x, this.y+this.radius-1+bob, this.radius*0.75, this.radius*0.22, 0, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.fill();

        ctx.save();
        ctx.translate(this.x, this.y+bob);
        ctx.rotate(Math.PI/4 + this._bobTime * 0.15);
        const s=this.radius*1.35;
        ctx.beginPath(); ctx.rect(-s/2,-s/2,s,s);
        ctx.fillStyle = state==='ATTACK'?'#e53935' : state==='CHASE'?'#ff5722' : '#ff8f00';
        ctx.fill(); ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1.2; ctx.stroke();
        ctx.restore();

        // Speed lines — more prominent when chasing
        if(state==='CHASE'||state==='ATTACK'){
            ctx.strokeStyle='rgba(255,140,0,0.5)'; ctx.lineWidth=1.5;
            for(let i=0;i<4;i++){
                const off=(i-1.5)*4;
                ctx.beginPath();
                ctx.moveTo(this.x-this.radius*2.8, this.y+off+bob);
                ctx.lineTo(this.x-this.radius*1.2, this.y+off+bob);
                ctx.stroke();
            }
        }
        this._drawCommon(ctx);
        ctx.restore();
    }
}

export class Brute extends EnemyBase {
    constructor(x, y, speedMult = 1) {
        super(x, y, speedMult, BC, buildBruteStates);
        this.type='brute'; this.chargeTimer=0; this.slamWarned=false;
    }
    draw(ctx) {
        if (this.dead) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        const state = this.fsm.getState();
        const slamming = state==='SLAM' && this.slamWarned;

        ctx.beginPath();
        ctx.ellipse(this.x, this.y+this.radius-3, this.radius*0.9, this.radius*0.32, 0, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill();

        if(slamming){
            const t=(this.attackTimer % BC.ATTACK_RATE)/BC.ATTACK_RATE;
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius+10+t*18, 0, Math.PI*2);
            ctx.strokeStyle=`rgba(255,30,0,${0.7*t})`; ctx.lineWidth=4; ctx.stroke();
        }

        ctx.beginPath();
        for(let i=0;i<6;i++){
            const a=(i/6)*Math.PI*2-Math.PI/6;
            const px=this.x+Math.cos(a)*this.radius, py=this.y+Math.sin(a)*this.radius;
            i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        }
        ctx.closePath();
        ctx.fillStyle = state==='SLAM'?'#6a1010' : state==='CHARGE'?'#7b1fa2' : '#4a148c';
        ctx.fill();
        ctx.strokeStyle = slamming?'#ff1744':'rgba(255,255,255,0.2)';
        ctx.lineWidth   = slamming?3:2; ctx.stroke();

        ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=2.5;
        ctx.beginPath();
        ctx.moveTo(this.x-10,this.y-8); ctx.lineTo(this.x-3,this.y-4);
        ctx.moveTo(this.x+10,this.y-8); ctx.lineTo(this.x+3,this.y-4);
        ctx.stroke();

        this._drawCommon(ctx);
        ctx.restore();
    }
}

export class Spitter extends EnemyBase {
    constructor(x, y, speedMult = 1) {
        super(x, y, speedMult, SPC, buildSpitterStates);
        this.type='spitter'; this.fireTimer=0; this._wobble=0;
    }
    draw(ctx) {
        if (this.dead) return;
        ctx.save();
        ctx.globalAlpha = this.alpha;
        this._wobble += 0.07;
        const w = Math.sin(this._wobble)*2;

        ctx.beginPath();
        ctx.ellipse(this.x, this.y+this.radius-1, this.radius*0.8, this.radius*0.25, 0, 0, Math.PI*2);
        ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fill();

        ctx.beginPath();
        ctx.ellipse(this.x, this.y+w*0.4, this.radius+w, this.radius-w*0.5, 0, 0, Math.PI*2);
        ctx.fillStyle = this.fsm.isIn('REPOSITION') ? '#1b5e20' : '#2e7d32';
        ctx.fill(); ctx.strokeStyle='#69f0ae'; ctx.lineWidth=1.5; ctx.stroke();

        const mp = 0.5+0.5*Math.abs(Math.sin(this._wobble*1.8));
        ctx.beginPath(); ctx.arc(this.x, this.y+3, 4*mp, 0, Math.PI*2);
        ctx.fillStyle='#76ff03'; ctx.shadowColor='#64dd17'; ctx.shadowBlur=10*mp;
        ctx.fill(); ctx.shadowBlur=0;

        for(const p of this.projectiles) p.draw(ctx);
        this._drawCommon(ctx);
        ctx.restore();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createEnemy(type, x, y, speedMult = 1) {
    switch(type){
        case 'runner':  return new Runner(x, y, speedMult);
        case 'brute':   return new Brute(x, y, speedMult);
        case 'spitter': return new Spitter(x, y, speedMult);
        default:        return new Zombie(x, y, speedMult);
    }
}

export function rollEnemyType(wave) {
    const r = Math.random();
    if (wave < 2) return 'zombie';
    if (wave < 3) return r < 0.65 ? 'zombie' : 'runner';
    if (wave < 5) {
        if (r < 0.45) return 'zombie';
        if (r < 0.75) return 'runner';
        if (r < 0.90) return 'spitter';
        return 'brute';
    }
    if (r < 0.30) return 'zombie';
    if (r < 0.55) return 'runner';
    if (r < 0.78) return 'spitter';
    return 'brute';
}

export { Zombie as Enemy };