class Sound {
    static ctx = null;

    static init() {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    static play(type, duration, freqStart, freqEnd, gainStart, gainEnd, exponential = false, delay = 0) {
        this.init();
        const now = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, now);
        if (freqEnd !== null) {
            if (exponential) osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
            else osc.frequency.linearRampToValueAtTime(freqEnd, now + duration);
        }
        gain.gain.setValueAtTime(gainStart, now);
        if (gainEnd !== null) gain.gain.linearRampToValueAtTime(gainEnd, now + duration);
        osc.start(now);
        osc.stop(now + duration);
    }

    static playJump() {
        this.play('triangle', 0.18, 160, 700, 0.12, 0.01, true);
    }

    static playCoin() {
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(987.77, now);
        osc.frequency.setValueAtTime(1318.51, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.setValueAtTime(0.1, now + 0.08);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.35);
        osc.start();
        osc.stop(now + 0.35);
    }

    static playStomp() {
        this.play('triangle', 0.12, 120, 30, 0.2, 0.01);
    }

    static playBrickHit() {
        this.play('triangle', 0.1, 80, 10, 0.15, 0.01);
    }

    static playSequence(type, notes, noteDur, step, gainVal) {
        this.init();
        notes.forEach((freq, idx) => {
            this.play(type, noteDur, freq, null, gainVal, 0.01, false, idx * step);
        });
    }

    static playPowerupSprout() {
        this.playSequence('sine', [330, 392, 330, 392, 330, 392], 0.05, 0.05, 0.08);
    }

    static playPowerup() {
        this.playSequence('triangle', [330, 392, 659, 523, 587, 784], 0.08, 0.08, 0.08);
    }

    static playPowerdown() {
        this.playSequence('sine', [784, 587, 523, 392, 330], 0.08, 0.08, 0.1);
    }

    static playLevelClear() {
        let offset = 0;
        [
            [523.25, 0.12], [659.25, 0.12], [783.99, 0.12],
            [1046.50, 0.18], [1318.51, 0.18], [1567.98, 0.35]
        ].forEach(([freq, d]) => {
            this.play('triangle', d, freq, null, 0.12, 0.01, false, offset);
            offset += d + 0.03;
        });
    }

    static playDeath() {
        let offset = 0;
        [493.88, 440.00, 392.00, 349.23, 329.63, 261.63].forEach(freq => {
            this.play('sawtooth', 0.15, freq, null, 0.1, 0.01, false, offset);
            offset += 0.18;
        });
    }
}

const GRAVITY = 0.55, FRICTION = 0.85, WALK_ACCEL = 0.35, WALK_SPEED_MAX = 4.2, JUMP_FORCE = 13.5, GROUND_Y = 100, GAME_WIDTH = 1200, WORLD_WIDTH = 4000;
let gameActive = false, levelCleared = false, marioDead = false, score = 0, coins = 0, timeRemaining = 360, timerInterval = null, cameraX = 0;

const mario = { x: 80, y: GROUND_Y, width: 36, height: 48, vx: 0, vy: 0, isJumping: false, facing: 'right', isBig: false, isInvulnerable: false, invulnerableTimer: 0, isAnimating: false };
const mushroom = { active: false, x: 0, y: 0, width: 32, height: 32, vx: 1.8, vy: 0, element: null };
let goombas = [], solids = [];
const keys = { left: false, right: false, jump: false };

const $ = id => document.getElementById(id);
const playerEl = $('player'), playerImgEl = $('player-img'), playerCanvasEl = $('player-canvas'), worldEl = $('world-container'),
      scoreValEl = $('score-val'), coinsValEl = $('coins-val'), timeValEl = $('time-val'), startScreenEl = $('start-screen'),
      gameOverScreenEl = $('game-over-screen'), victoryScreenEl = $('victory-screen'), finalScoreEl = $('final-score'),
      mushroomEl = $('mushroom'), flagEl = $('flag');

const getAABBOverlap = (r1, r2) => ({
    xOverlap: Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left)),
    yOverlap: Math.max(0, Math.min(r1.top, r2.top) - Math.max(r1.bottom, r2.bottom))
});
const checkAABBCollision = (r1, r2) => r1.left < r2.right && r1.right > r2.left && r1.bottom < r2.top && r1.top > r2.bottom;

function parseWorldSolids() {
    solids = [...document.querySelectorAll('[class^="pipe-p"], [class^="brick-b"], .question')].map(el => {
        const s = window.getComputedStyle(el);
        const left = parseFloat(s.left), bottom = parseFloat(s.bottom), w = parseFloat(s.width), h = parseFloat(s.height);
        return {
            id: el.id || el.className, element: el, left, right: left + w, bottom, top: bottom + h, width: w, height: h,
            type: el.className.includes('question') ? 'question' : (el.className.includes('pipe') ? 'pipe' : 'brick'),
            isUsed: el.classList.contains('empty')
        };
    });
}

function spawnGoombas() {
    document.querySelectorAll('.goomba').forEach(g => g.remove());
    goombas = [480, 820, 1120, 1600, 2300].map((x, idx) => {
        const img = document.createElement('img');
        Object.assign(img, { src: 'Assets/mushroomm.png', className: 'goomba', id: `goomba-${idx}` });
        Object.assign(img.style, { left: `${x}px`, bottom: '100px' });
        worldEl.appendChild(img);
        return { element: img, x, y: 100, width: 44, height: 44, vx: -1.2, vy: 0, stomped: false };
    });
}

function sproutMushroom() {
    Object.assign(mushroom, { active: true, x: 704, y: 220, vy: 0, vx: 1.6 });
    mushroomEl.classList.remove('hidden');
    mushroomEl.style.left = `${mushroom.x}px`;
    mushroomEl.style.bottom = `${mushroom.y}px`;
    Sound.playPowerupSprout();

    let sproutCounter = 0;
    const sprout = () => {
        if (sproutCounter++ < 40) {
            mushroom.y += 1.0;
            mushroomEl.style.bottom = `${mushroom.y}px`;
            requestAnimationFrame(sprout);
        } else {
            mushroom.y = 260;
        }
    };
    sprout();
}

function shatterBrick(brick) {
    brick.element.style.display = 'none';
    solids = solids.filter(s => s.id !== brick.id);
    Sound.playBrickHit();
    addScore(50);

    [[-2.5, 7], [-1.2, 9], [1.2, 9], [2.5, 7]].forEach(([pvx, pvy]) => {
        const piece = document.createElement('div');
        Object.assign(piece.style, {
            position: 'absolute', left: `${brick.left + 12}px`, bottom: `${brick.bottom + 12}px`,
            width: '14px', height: '14px', backgroundColor: '#b5651d', border: '2px solid #000', zIndex: '15'
        });
        worldEl.appendChild(piece);

        let px = brick.left + 12, py = brick.bottom + 12;
        const updateDebris = () => {
            pvy -= 0.6; px += pvx; py += pvy;
            Object.assign(piece.style, { left: `${px}px`, bottom: `${py}px` });
            if (py > -50) requestAnimationFrame(updateDebris);
            else piece.remove();
        };
        updateDebris();
    });
}

const bounceBlock = el => {
    el.classList.add('block-bounce');
    setTimeout(() => el.classList.remove('block-bounce'), 150);
};

function spawnCoinPop(x, y) {
    const coin = document.createElement('div');
    coin.className = 'coin-pop';
    Object.assign(coin.style, { left: `${x + 12}px`, bottom: `${y + 40}px` });
    worldEl.appendChild(coin);
    Sound.playCoin();
    setTimeout(() => coin.remove(), 350);
}

function handleBlockHit(brick) {
    if (brick.type === 'question' && !brick.isUsed) {
        brick.isUsed = true;
        brick.element.classList.add('empty');
        if (brick.element.id === 'q3') sproutMushroom();
        else {
            spawnCoinPop(brick.left, brick.bottom);
            addCoin();
            addScore(200);
        }
        bounceBlock(brick.element);
    } else if (brick.type === 'brick') {
        if (mario.isBig) shatterBrick(brick);
        else {
            bounceBlock(brick.element);
            Sound.playBrickHit();
        }
    }
}

function setupInputs() {
    const keyMap = {
        ArrowLeft: 'left', a: 'left', A: 'left',
        ArrowRight: 'right', d: 'right', D: 'right',
        ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump'
    };

    window.addEventListener('keydown', e => {
        if (!gameActive) {
            if (e.key === 'Enter') startGame();
            return;
        }
        if (keyMap[e.key]) keys[keyMap[e.key]] = true;
        if (e.key === 'Enter' && (marioDead || levelCleared)) startGame();
    });

    window.addEventListener('keyup', e => {
        if (keyMap[e.key]) keys[keyMap[e.key]] = false;
    });

    const bindBtn = (id, keyName) => {
        const btn = $(id);
        if (!btn) return;
        const setKey = (val, e) => {
            if (e) e.preventDefault();
            if (!gameActive) startGame();
            else keys[keyName] = val;
        };
        btn.addEventListener('touchstart', e => setKey(true, e), { passive: false });
        btn.addEventListener('touchend', e => setKey(false, e), { passive: false });
        btn.addEventListener('mousedown', () => setKey(true));
        ['mouseup', 'mouseleave'].forEach(evt => btn.addEventListener(evt, () => keys[keyName] = false));
    };

    bindBtn('btn-left', 'left');
    bindBtn('btn-right', 'right');
    bindBtn('btn-jump', 'jump');

    [startScreenEl, gameOverScreenEl, victoryScreenEl].forEach(el => el && el.addEventListener('click', startGame));
}

const addScore = amt => {
    score += amt;
    if (scoreValEl) scoreValEl.textContent = String(score).padStart(6, '0');
};
const addCoin = () => {
    coins++;
    if (coinsValEl) coinsValEl.textContent = `🪙 x${String(coins).padStart(2, '0')}`;
};

function initPlayerCanvas() {
    const ctx = playerCanvasEl.getContext('2d');
    const draw = () => {
        playerCanvasEl.width = playerImgEl.naturalWidth || 60;
        playerCanvasEl.height = playerImgEl.naturalHeight || 60;
        ctx.drawImage(playerImgEl, 0, 0);
    };
    if (playerImgEl.complete) draw();
    else playerImgEl.addEventListener('load', draw);
}

function update(timestamp) {
    if (!gameActive || marioDead || levelCleared) return;

    if (mario.isInvulnerable) {
        mario.invulnerableTimer -= 16.67;
        if (mario.invulnerableTimer <= 0) {
            mario.isInvulnerable = false;
            playerEl.style.opacity = '1.0';
        } else {
            playerEl.style.opacity = Math.floor(mario.invulnerableTimer / 100) % 2 === 0 ? '0.4' : '0.9';
        }
    }

    if (keys.left) {
        mario.vx -= WALK_ACCEL;
        mario.facing = 'left';
    } else if (keys.right) {
        mario.vx += WALK_ACCEL;
        mario.facing = 'right';
    } else {
        mario.vx *= FRICTION;
        if (Math.abs(mario.vx) < 0.1) mario.vx = 0;
    }

    if (mario.vx > WALK_SPEED_MAX) mario.vx = WALK_SPEED_MAX;
    if (mario.vx < -WALK_SPEED_MAX) mario.vx = -WALK_SPEED_MAX;

    mario.vy -= GRAVITY;

    if (keys.jump && !mario.isJumping) {
        mario.vy = JUMP_FORCE;
        mario.isJumping = true;
        Sound.playJump();
    }

    const marioBox = () => ({
        left: mario.x, right: mario.x + mario.width,
        bottom: mario.y, top: mario.y + mario.height
    });

    mario.x += mario.vx;
    if (mario.x < 0) { mario.x = 0; mario.vx = 0; }
    else if (mario.x > WORLD_WIDTH - mario.width) { mario.x = WORLD_WIDTH - mario.width; mario.vx = 0; }

    let box = marioBox();
    solids.forEach(solid => {
        if (checkAABBCollision(box, solid)) {
            const overlaps = getAABBOverlap(box, solid);
            if (overlaps.xOverlap > 0) {
                if (mario.vx > 0) { mario.x -= overlaps.xOverlap; mario.vx = 0; }
                else if (mario.vx < 0) { mario.x += overlaps.xOverlap; mario.vx = 0; }
            }
        }
    });

    mario.y += mario.vy;
    let groundedThisFrame = false;
    box = marioBox();

    solids.forEach(solid => {
        if (checkAABBCollision(box, solid)) {
            const overlaps = getAABBOverlap(box, solid);
            if (overlaps.yOverlap > 0) {
                if (mario.vy > 0) {
                    mario.y -= overlaps.yOverlap;
                    mario.vy = -0.5;
                    handleBlockHit(solid);
                } else if (mario.vy < 0) {
                    mario.y += overlaps.yOverlap;
                    mario.vy = 0;
                    mario.isJumping = false;
                    groundedThisFrame = true;
                }
            }
        }
    });

    if (mario.y <= GROUND_Y) {
        mario.y = GROUND_Y;
        mario.vy = 0;
        mario.isJumping = false;
        groundedThisFrame = true;
    }

    if (!groundedThisFrame && mario.y > GROUND_Y) {
        mario.isJumping = true;
    }

    if (mushroom.active) {
        mushroom.vy -= GRAVITY;
        mushroom.x += mushroom.vx;

        if (mushroom.x < 0 || mushroom.x > WORLD_WIDTH - mushroom.width) {
            mushroom.vx = -mushroom.vx;
        }

        const mushroomBox = () => ({
            left: mushroom.x, right: mushroom.x + mushroom.width,
            bottom: mushroom.y, top: mushroom.y + mushroom.height
        });

        let mBox = mushroomBox();
        solids.forEach(solid => {
            if (checkAABBCollision(mBox, solid)) {
                const overlaps = getAABBOverlap(mBox, solid);
                if (overlaps.xOverlap > 0 && overlaps.yOverlap > 2) {
                    mushroom.x -= (mushroom.vx > 0 ? overlaps.xOverlap : -overlaps.xOverlap);
                    mushroom.vx = -mushroom.vx;
                }
            }
        });

        mushroom.y += mushroom.vy;
        mBox = mushroomBox();
        solids.forEach(solid => {
            if (checkAABBCollision(mBox, solid)) {
                const overlaps = getAABBOverlap(mBox, solid);
                if (overlaps.yOverlap > 0 && mushroom.vy < 0) {
                    mushroom.y += overlaps.yOverlap;
                    mushroom.vy = 0;
                }
            }
        });

        if (mushroom.y <= GROUND_Y) {
            mushroom.y = GROUND_Y;
            mushroom.vy = 0;
        }

        mushroomEl.style.left = `${mushroom.x}px`;
        mushroomEl.style.bottom = `${mushroom.y}px`;

        if (checkAABBCollision(marioBox(), mushroomBox())) {
            mushroom.active = false;
            mushroomEl.classList.add('hidden');
            addScore(1000);
            
            if (!mario.isBig) {
                mario.isBig = true;
                mario.height = 64;
                playerEl.classList.add('big');
                Sound.playPowerup();
            }
        }
    }

    goombas.forEach(goomba => {
        if (goomba.stomped) return;

        goomba.vy -= GRAVITY;
        goomba.x += goomba.vx;

        const goombaBox = () => ({
            left: goomba.x, right: goomba.x + goomba.width,
            bottom: goomba.y, top: goomba.y + goomba.height
        });

        let gBox = goombaBox();
        
        solids.forEach(solid => {
            if (checkAABBCollision(gBox, solid)) {
                const overlaps = getAABBOverlap(gBox, solid);
                if (overlaps.xOverlap > 0 && overlaps.yOverlap > 4) {
                    goomba.x -= (goomba.vx > 0 ? overlaps.xOverlap : -overlaps.xOverlap);
                    goomba.vx = -goomba.vx;
                }
            }
        });

        goomba.y += goomba.vy;
        gBox = goombaBox();
        solids.forEach(solid => {
            if (checkAABBCollision(gBox, solid)) {
                const overlaps = getAABBOverlap(gBox, solid);
                if (overlaps.yOverlap > 0 && goomba.vy < 0) {
                    goomba.y += overlaps.yOverlap;
                    goomba.vy = 0;
                }
            }
        });

        if (goomba.y <= GROUND_Y) {
            goomba.y = GROUND_Y;
            goomba.vy = 0;
        }

        goomba.element.style.left = `${goomba.x}px`;
        goomba.element.style.bottom = `${goomba.y}px`;

        if (checkAABBCollision(marioBox(), gBox)) {
            if (mario.vy < 0 && (mario.y > goomba.y + goomba.height - 12)) {
                goomba.stomped = true;
                goomba.vx = 0;
                goomba.element.classList.add('stomped');
                addScore(100);
                mario.vy = 7.5;
                Sound.playStomp();
                setTimeout(() => goomba.element.remove(), 500);
            } else {
                if (!mario.isInvulnerable) {
                    if (mario.isBig) {
                        mario.isBig = false;
                        mario.height = 48;
                        playerEl.classList.remove('big');
                        mario.isInvulnerable = true;
                        mario.invulnerableTimer = 2000;
                        Sound.playPowerdown();
                    } else {
                        killMario();
                    }
                }
            }
        }
    });

    if (mario.x >= 3584 && !levelCleared) {
        triggerVictory();
    }

    playerEl.style.left = `${mario.x}px`;
    playerEl.style.bottom = `${mario.y}px`;
    playerEl.classList.toggle('face-left', mario.facing === 'left');

    const isMoving = Math.abs(mario.vx) > 0.1 || mario.isJumping;
    playerImgEl.classList.toggle('hidden', !isMoving);
    playerCanvasEl.classList.toggle('hidden', isMoving);

    const targetCamX = mario.x - GAME_WIDTH / 2.5;
    cameraX = Math.max(0, Math.min(WORLD_WIDTH - GAME_WIDTH, targetCamX));
    worldEl.style.transform = `translateX(${-cameraX}px)`;

    requestAnimationFrame(update);
}

function killMario() {
    marioDead = true;
    keys.left = keys.right = keys.jump = false;
    Sound.playDeath();
    clearInterval(timerInterval);
    mario.vy = 12.0;
    
    const deathLoop = () => {
        mario.vy -= 0.5;
        mario.y += mario.vy;
        playerEl.style.bottom = `${mario.y}px`;
        if (mario.y > -100) requestAnimationFrame(deathLoop);
        else gameOver();
    };
    deathLoop();
}

function gameOver() {
    gameActive = false;
    gameOverScreenEl.classList.remove('hidden');
}

function triggerVictory() {
    levelCleared = true;
    keys.left = keys.right = keys.jump = false;
    clearInterval(timerInterval);
    Sound.playLevelClear();
    flagEl.style.top = '200px';

    let slideInterval = setInterval(() => {
        if (mario.y > GROUND_Y) {
            mario.y -= 3.0;
            playerEl.style.bottom = `${mario.y}px`;
        } else {
            clearInterval(slideInterval);
            mario.y = GROUND_Y;
            walkToCastle();
        }
    }, 16);
}

function walkToCastle() {
    mario.facing = 'right';
    const walk = () => {
        if (mario.x < 3790) {
            mario.x += 2.0;
            playerEl.style.left = `${mario.x}px`;
            playerImgEl.classList.remove('hidden');
            playerCanvasEl.classList.add('hidden');

            const targetCamX = mario.x - GAME_WIDTH / 2.5;
            cameraX = Math.max(0, Math.min(WORLD_WIDTH - GAME_WIDTH, targetCamX));
            worldEl.style.transform = `translateX(${-cameraX}px)`;
            requestAnimationFrame(walk);
        } else {
            playerEl.style.transition = 'opacity 0.5s ease';
            playerEl.style.opacity = '0';
            addScore(timeRemaining * 10);
            setTimeout(showVictoryScreen, 800);
        }
    };
    walk();
}

function showVictoryScreen() {
    gameActive = false;
    if (finalScoreEl) finalScoreEl.textContent = `FINAL SCORE: ${String(score).padStart(6, '0')}`;
    victoryScreenEl.classList.remove('hidden');
}

function startGame() {
    Sound.init();
    [startScreenEl, gameOverScreenEl, victoryScreenEl].forEach(el => el.classList.add('hidden'));

    levelCleared = marioDead = false;
    score = coins = cameraX = 0;
    timeRemaining = 360;

    if (scoreValEl) scoreValEl.textContent = "000000";
    if (coinsValEl) coinsValEl.textContent = "🪙 x00";
    timeValEl.textContent = "360";

    Object.assign(mario, { x: 80, y: GROUND_Y, vx: 0, vy: 0, isJumping: false, facing: 'right', isBig: false, height: 48, isInvulnerable: false });
    
    Object.assign(playerEl.style, { opacity: '1.0', transition: 'none', left: `${mario.x}px`, bottom: `${mario.y}px` });
    playerEl.classList.remove('big');
    flagEl.style.top = '20px';

    parseWorldSolids();
    spawnGoombas();

    document.querySelectorAll('.question').forEach(q => q.classList.remove('empty'));
    document.querySelectorAll('[class^="brick-b"]').forEach(b => b.style.display = 'block');

    mushroom.active = false;
    mushroomEl.classList.add('hidden');

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameActive && !levelCleared && !marioDead) {
            timeRemaining--;
            timeValEl.textContent = String(timeRemaining);
            if (timeRemaining <= 0) killMario();
        }
    }, 1000);

    gameActive = true;
    requestAnimationFrame(update);

    mario.vy = JUMP_FORCE;
    mario.isJumping = true;
    Sound.playJump();
}

window.addEventListener('load', () => {
    setupInputs();
    parseWorldSolids();
    initPlayerCanvas();
    startGame();
});
