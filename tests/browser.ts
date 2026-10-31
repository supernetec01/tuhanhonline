import { chromium, expect, type Page } from '@playwright/test';
import { MediaService } from '../server/media.js';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { connectDb } from '../server/db.js';
import { RoomService } from '../server/room.js';
if (!process.env.REDIS_KEY_PREFIX?.startsWith('browser_'))
  throw new Error('Run via pnpm test:browser: isolated database and Redis namespace required.');
const base = process.env.TEST_ORIGIN!,
  pool = connectDb(),
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  }),
  page = await context.newPage();
const errors: string[] = [];
function monitor(p: Page) {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
}
monitor(page);
const audioRequests: string[] = [];
page.on('request', (r) => {
  if (new URL(r.url()).pathname.startsWith('/api/media/')) audioRequests.push(r.url());
});
const instrumentAudio = () => {
  const Native = window.AudioContext;
  const probe = {
    sources: [] as { loop: boolean; duration: number; time: number }[],
    gains: [] as { id: number; value: number }[],
    contexts: 0,
  };
  (window as any).__audioProbe = probe;
  (window as any).AudioContext = class extends Native {
    constructor(...args: any[]) {
      super(...args);
      probe.contexts++;
      (window as any).__audioContext = this;
    }
    createBufferSource() {
      const source = super.createBufferSource(),
        start = source.start.bind(source);
      source.start = ((...args: any[]) => {
        probe.sources.push({
          loop: source.loop,
          duration: source.buffer?.duration ?? 0,
          time: this.currentTime,
        });
        return (start as any)(...args);
      }) as typeof source.start;
      return source;
    }
    createGain() {
      const gain = super.createGain(),
        id = (this as any).__gainId ?? 0;
      (this as any).__gainId = id + 1;
      const target = gain.gain.setTargetAtTime.bind(gain.gain);
      gain.gain.setTargetAtTime = ((v: number, ...args: any[]) => {
        probe.gains.push({ id, value: v });
        return (target as any)(v, ...args);
      }) as typeof gain.gain.setTargetAtTime;
      return gain;
    }
  };
};
await context.addInitScript(instrumentAudio);
const username = `ui_${Date.now().toString(36)}`,
  password = 'Mat-khau-Phaser-kiem-thu-2026!';
async function register(p: Page, name: string, dharmaName: string) {
  await p.getByLabel('Tên đăng nhập', { exact: true }).fill(name);
  await p.getByLabel('Pháp danh', { exact: true }).fill(dharmaName);
  await p.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await p.getByRole('button', { name: 'Tạo tài khoản & bước vào', exact: true }).click();
  await expect(
    p.getByRole('button', { name: 'Tạo tài khoản & bước vào', exact: true }),
  ).toHaveCount(0, { timeout: 15000 });
}
async function ready(p: Page, count = 36) {
  await p.locator('.phaser-host[data-ready="true"]').waitFor({ timeout: 30000 });
  await expect(p.locator('.seat-target')).toHaveCount(count);
}
await mkdir('test-results', { recursive: true });
try {
  // Synthetic fixtures for playback tests only; these are not the user's missing V2 originals.
  const actor = randomUUID();
  await pool.query(
    "INSERT INTO users(id,name,password_hash,role) VALUES($1,'Audio fixture','test-no-login','ADMIN')",
    [actor],
  );
  const makeAudio = (duration: number) =>
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=48000',
      '-t',
      String(duration),
      '-c:a',
      'libopus',
      '-f',
      'ogg',
      'pipe:1',
    ]).toString('base64');
  const media = new MediaService(pool),
    music = makeAudio(2),
    sfx = makeAudio(0.12);
  const fixtureAudio: Record<string, string> = {};
  for (const cue of [
    'background',
    'waitingBackground',
    'bow',
    'incense',
    'seat',
    'invitation',
    'purchase',
    'coin',
    'welcome',
    'blessing',
  ]) {
    const asset = await media.upload(
      actor,
      cue === 'background' || cue === 'waitingBackground' ? 'music' : 'sfx',
      'TEST ONLY ' + cue,
      cue === 'background' || cue === 'waitingBackground' ? music : sfx,
    );
    fixtureAudio[cue] = asset.id;
  }
  const voice = await media.upload(actor, 'voice', 'TEST ONLY static blessing', makeAudio(0.8));
  await pool.query(
    "UPDATE config_revisions SET config=jsonb_set(jsonb_set(config,'{audio}',$1::jsonb),'{blessings}',$2::jsonb) WHERE status='published'",
    [
      JSON.stringify(fixtureAudio),
      JSON.stringify([
        { id: 'fixture', text: 'Cảm ơn, chúc bạn luôn bình an.', audioId: voice.id },
      ]),
    ],
  );
  await page.goto(base);
  await ready(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.game-room-count')).toContainText('36 NPC');
  expect((await pool.query('SELECT count(*)::int AS n FROM room_entries')).rows[0].n).toBe(0);
  expect(audioRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Vào chánh điện và bật âm thanh', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length),
    )
    .toBe(1);
  const opening = await page.evaluate(() => (window as any).__audioProbe.sources);
  const welcome = opening.find((s: any) => !s.loop),
    ambient = opening.find((s: any) => s.loop);
  expect(welcome).toBeTruthy();
  expect(ambient.time).toBeGreaterThanOrEqual(welcome.time + welcome.duration - 0.01);
  expect(audioRequests.some((url) => url.includes(fixtureAudio.background))).toBe(true);
  expect(audioRequests.some((url) => url.includes(fixtureAudio.waitingBackground))).toBe(false);
  const initialLoops = await page.evaluate(
    () => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length,
  );

  await page.screenshot({ path: 'test-results/single-game.png' });
  await page.getByRole('button', { name: 'Ghế A3 trống', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await register(page, username, 'An Nhiên');
  await expect(page.locator('.dock-presence')).toContainText('A3', { timeout: 10000 });
  expect(new URL(page.url()).pathname).toBe('/');
  const u = (await pool.query('SELECT * FROM users WHERE username=$1', [username])).rows[0];
  await expect(page.locator('.game-room-count')).toContainText('35 NPC');
  await expect
    .poll(async () =>
      (await page.locator('.phaser-host').getAttribute('data-npc-rendered'))
        ?.split(',')
        .includes('3'),
    )
    .toBe(false);
  expect(u.email).toBeNull();
  expect(u.verified_at).toBeNull();
  expect((await context.cookies()).some((c) => c.name === 'temple_session' && c.httpOnly)).toBe(
    true,
  );
  await page.evaluate(() => {
    (window as any).__v8Canvas = document.querySelector('canvas');
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Tin nhắn', { exact: true }).fill('Chúc các đạo hữu bình an');
  await page.getByRole('button', { name: 'Gửi', exact: true }).click();
  await expect(page.locator('.chat-history')).toContainText('Chúc các đạo hữu bình an');
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => document.querySelector('canvas') === (window as any).__v8Canvas),
  ).toBe(true);
  await expect(page.locator('.dock-presence')).toContainText('A3');
  await page.getByRole('button', { name: 'Nhật ký', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('phút tu hợp lệ');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Bảo Các', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bảo Các Thanh Liên' })).toBeVisible();
  await page.getByRole('button', { name: 'Bàn tọa / Đài sen', exact: true }).click();
  await expect(page.locator('.store-card')).toHaveCount(10);
  await page.getByRole('button', { name: /Đài Sen Hồng/ }).click();
  await expect(page.locator('[data-preview-seat="seat_hong"]')).toBeVisible();
  await page.getByRole('button', { name: 'Ngắm tại ghế', exact: true }).click();
  await expect(page.locator('.store-inspect-bar')).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/store-v9-seat-preview.png' });
  await page.getByRole('button', { name: 'Quay lại cửa hàng', exact: true }).click();
  expect(
    (await pool.query('SELECT cosmetics FROM users WHERE id=$1', [u.id])).rows[0].cosmetics.seat,
  ).toBe('seat_moc');
  await page.getByRole('button', { name: 'Trang trí', exact: true }).click();
  await page.getByRole('button', { name: /Chấm Vàng Nhạt/ }).click();
  await page.getByRole('button', { name: 'Mua · 100 xu', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận mua · 100 xu', exact: true }).click();
  await page.getByRole('button', { name: 'Mặc / dùng ngay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang trang bị', exact: true })).toBeDisabled();
  expect(
    (await pool.query('SELECT cosmetics FROM users WHERE id=$1', [u.id])).rows[0].cosmetics
      .dotStyle,
  ).toBe('dots_gold');
  await page.screenshot({ path: 'test-results/store-v9.png' });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => document.querySelector('canvas') === (window as any).__v8Canvas),
  ).toBe(true);
  await expect(page.locator('.dock-presence')).toContainText('A3');
  expect(
    await page.evaluate(
      () => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length,
    ),
  ).toBe(initialLoops);
  await page.evaluate(() => (window as any).__audioContext.suspend());
  await expect(
    page.getByRole('button', { name: 'Vào chánh điện và bật âm thanh', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vào chánh điện và bật âm thanh', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length,
    ),
  ).toBe(initialLoops);
  await page.getByRole('button', { name: 'Tủ đồ', exact: true }).click();
  await page.getByRole('button', { name: /Nắng ban mai/ }).click();
  await page.getByRole('button', { name: 'Chuỗi hạt', exact: true }).click();
  await expect(page.locator('.robe-preview [data-layer]')).toHaveCount(10);
  await expect(page.locator('.robe-preview [data-layer="accessory"] circle')).toHaveCount(11);
  await page.getByRole('button', { name: 'Mặt sau', exact: true }).click();
  await expect(page.locator('.robe-preview [data-layer="hands"] path')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mặt trước', exact: true }).click();
  await page.getByRole('button', { name: 'Sở hữu với 180 xu' }).click();
  await page.getByRole('button', { name: 'Xác nhận mua · 180 xu' }).click();
  await page.getByRole('button', { name: 'Mặc trang phục', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang mặc', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/wardrobe.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Vái', exact: true }).click();
  await expect.poll(async () => !!(await new RoomService(pool).myAction(u.id))).toBe(true);
  await page.screenshot({ path: 'test-results/single-game-player.png' });
  await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'An Nhiên' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username.toUpperCase());
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ghế A3 trống', exact: true }).click();
  await expect(page.locator('.dock-presence')).toContainText('A3');
  const roomService = new RoomService(pool);
  for (let i = 0; i < 35; i++) {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users(id,email,password_hash,name,username) VALUES($1,NULL,$2,$3,$4)',
      [id, u.password_hash, `Đạo hữu ${i + 1}`, `f_${randomBytes(8).toString('hex')}`],
    );
    await roomService.join(id, randomUUID());
  }
  await expect(page.locator('.game-room-count')).toContainText('36/36', { timeout: 15000 });
  await page.screenshot({ path: 'test-results/temple-full.png' });
  const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    }),
    mobile = await mobileContext.newPage();
  await mobileContext.addInitScript(instrumentAudio);
  monitor(mobile);
  await mobile.goto(base);
  await ready(mobile);
  await mobile.getByRole('button', { name: 'Vào chánh điện và bật âm thanh', exact: true }).click();
  await expect
    .poll(() =>
      mobile.evaluate(() => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length),
    )
    .toBe(1);
  await mobile.getByRole('button', { name: 'Vào chánh điện', exact: true }).click();
  await register(mobile, `${username}_m`, 'Tâm An');
  await expect(mobile.getByRole('heading', { name: 'Xin chờ một duyên lành' })).toBeVisible({
    timeout: 10000,
  });
  expect(new URL(mobile.url()).pathname).toBe('/');
  await expect
    .poll(() =>
      mobile.evaluate(() => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length),
    )
    .toBe(2);
  await mobile.screenshot({ path: 'test-results/queue-popup.png' });
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: 'Đã có chỗ cho bạn' })).toBeVisible({
    timeout: 15000,
  });
  await mobile.getByRole('button', { name: 'Nhận chỗ ngồi', exact: true }).click();
  await expect(mobile.locator('.dock-presence')).toContainText('A3');
  await expect
    .poll(() =>
      mobile.evaluate(() => (window as any).__audioProbe.sources.filter((s: any) => s.loop).length),
    )
    .toBe(3);
  await mobile.getByRole('button', { name: 'Âm thanh', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: 'Lắng nghe & tĩnh tâm' })).toBeVisible();
  await mobile.getByLabel('Tắt tiếng', { exact: true }).check();
  await mobile.getByRole('button', { name: 'Đóng cửa sổ', exact: true }).click();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: 'test-results/mobile.png' });
  await mobile.getByRole('button', { name: 'Tủ đồ', exact: true }).click();
  await mobile.getByRole('button', { name: 'Hoa sen', exact: true }).click();
  await mobile.screenshot({ path: 'test-results/mobile-wardrobe.png' });
  await mobile.reload();
  await ready(mobile);
  await mobile.getByRole('button', { name: 'Âm thanh', exact: true }).click();
  await expect(mobile.getByLabel('Tắt tiếng', { exact: true })).toBeChecked();
  await expect(
    mobile.getByRole('button', { name: 'Bật / tiếp tục âm thanh', exact: true }),
  ).toBeVisible();
  await mobileContext.close();
  await page.goto(base + '/admin');
  await expect(page.getByRole('heading', { name: 'Chưa có quyền quản trị' })).toBeVisible();
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [u.id]);
  await page.goto(base + '/admin');
  await expect(page.getByRole('heading', { name: 'Nội dung & cấu hình' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Xác thực hai bước' })).toHaveCount(0);
  await expect(page.getByLabel('Mã xác thực', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nội dung & cấu hình' })).toBeVisible();
  await page.getByLabel('Tên phòng', { exact: true }).fill('Chánh điện Phaser kiểm thử');
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Đã xuất bản');
  await page.getByRole('button', { name: 'Mô phỏng nhận quà', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Đã tiếp nhận');
  await page.getByRole('button', { name: 'Tạo phiên màn hình OBS · 30 phút' }).click();
  const href = await page.locator('.broadcast-link').getAttribute('href');
  const broadcast = await context.newPage();
  monitor(broadcast);
  await broadcast.goto(base + href);
  await broadcast.getByRole('button', { name: 'Bật nhận lời chúc / cho phép âm thanh' }).click();
  await expect(broadcast.locator('.broadcast-caption p')).toContainText('Cảm ơn', {
    timeout: 12000,
  });
  await expect
    .poll(() =>
      broadcast.evaluate(() =>
        (window as any).__audioProbe.gains.some(
          (g: any) => g.id === 1 && Math.abs(g.value - 0.04) < 0.001,
        ),
      ),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const s = await broadcast.evaluate(() => (window as any).__audioProbe.sources);
      return s.some((x: any) => !x.loop && x.duration > 0.5);
    })
    .toBe(true);
  await expect
    .poll(() =>
      broadcast.evaluate(() => {
        const gains = (window as any).__audioProbe.gains.filter((g: any) => g.id === 1);
        return gains.at(-1)?.value;
      }),
    )
    .toBe(0.16);
  await broadcast.screenshot({ path: 'test-results/broadcast.png' });
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
  await broadcast.close();
  // V11 uses the same real reservation model; fixture humans exist only in this isolated schema.
  await pool.query(
    "UPDATE room_entries SET status='CANCELLED',ended_at=clock_timestamp() WHERE status IN ('ACTIVE','INVITED','WAITING')",
  );
  await page.getByRole('button', { name: 'Dùng sơ đồ 72 vị trí', exact: true }).click();
  await page.getByLabel('Chế độ NPC', { exact: true }).selectOption('fill');
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.locator('.success-note')).toContainText('Đã xuất bản');
  const npcView = await context.newPage();
  monitor(npcView);
  await npcView.addInitScript(() => {
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    (window as any).__templeSockets = sockets;
    (window as any).WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/socket.io/')) sockets.push(this);
      }
    };
  });
  await npcView.goto(base);
  await ready(npcView, 72);
  await expect(npcView.locator('.game-room-count')).toContainText('0/72 người thật');
  await expect(npcView.locator('.game-room-count')).toContainText('72 NPC');
  await npcView.screenshot({ path: 'test-results/npc-v11-72.png' });
  const weakContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  });
  await weakContext.addInitScript({
    content:
      "Object.defineProperty(navigator, 'hardwareConcurrency', {get: function(){return 2;}});",
  });
  const weakPage = await weakContext.newPage();
  monitor(weakPage);
  await weakPage.goto(base);
  await ready(weakPage, 72);
  await expect(weakPage.locator('.game-room-count')).toContainText('72 NPC');
  await expect(weakPage.locator('.phaser-host')).toHaveAttribute('data-npc-motion', 'static');
  expect(await weakPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await weakPage.screenshot({ path: 'test-results/npc-v11-mobile.png' });
  await weakContext.close();

  const realIds: string[] = [];
  async function addHumans(n: number) {
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      realIds.push(id);
      await pool.query('INSERT INTO users(id,name,password_hash,username) VALUES($1,$2,$3,$4)', [
        id,
        'Đạo hữu thử ' + realIds.length,
        u.password_hash,
        'v11_' + randomBytes(8).toString('hex'),
      ]);
      await roomService.join(id, randomUUID());
    }
  }
  await addHumans(36);
  await expect(npcView.locator('.game-room-count')).toContainText('36/72 người thật', {
    timeout: 15000,
  });
  await expect(npcView.locator('.game-room-count')).toContainText('36 NPC');
  await npcView.screenshot({ path: 'test-results/npc-v11-36-humans.png' });
  await addHumans(36);
  await expect(npcView.locator('.game-room-count')).toContainText('72/72 người thật', {
    timeout: 15000,
  });
  await expect(npcView.locator('.game-room-count')).toContainText('0 NPC');
  await expect(npcView.locator('.phaser-host')).toHaveAttribute('data-npc-rendered', '');
  await roomService.leave(realIds[0]);
  await expect(npcView.locator('.game-room-count')).toContainText('71/72 người thật');
  await expect(npcView.locator('.game-room-count')).toContainText('1 NPC', { timeout: 10000 });
  await npcView.getByRole('button', { name: 'Ghế A1 trống', exact: true }).click();
  await expect(npcView.locator('.game-room-count')).toContainText('72/72 người thật');
  await expect(npcView.locator('.game-room-count')).toContainText('0 NPC');
  await npcView.reload();
  await ready(npcView, 72);
  await expect(npcView.locator('.game-room-count')).toContainText('72/72 người thật');
  await pool.query(
    "UPDATE room_entries SET status='CANCELLED',ended_at=clock_timestamp() WHERE status IN ('ACTIVE','INVITED','WAITING')",
  );
  await page.getByLabel('Chế độ NPC', { exact: true }).selectOption('half');
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(npcView.locator('.game-room-count')).toContainText('0/72 người thật', {
    timeout: 15000,
  });
  await expect(npcView.locator('.game-room-count')).toContainText('36 NPC', { timeout: 10000 });
  await page.getByLabel('Chế độ NPC', { exact: true }).selectOption('off');
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(npcView.locator('.game-room-count')).toContainText('0 NPC');
  await expect(npcView.locator('.phaser-host')).toHaveAttribute('data-npc-rendered', '');
  await expect
    .poll(() =>
      npcView.evaluate(
        () =>
          (window as any).__templeSockets.filter((s: WebSocket) => s.readyState === WebSocket.OPEN)
            .length,
      ),
    )
    .toBe(1);
  await npcView.close();
  expect(errors).toEqual([]);
  console.log(
    'PASS: real Phaser canvas, 36 clickable seats, username/no-email auto-login, selected-seat grant, layered wardrobe/equip, ritual API, logout/case-insensitive login, full-room FIFO popup + invitation acceptance on mobile, audio/account popups without navigation, Admin password access/reload/publish, USER denied, mock broadcast and V11 NPCs.',
  );
} catch (e) {
  if (!(await page.locator('.mfa-secret').count()))
    await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
  if (errors.length) console.error('Browser errors:', errors);
  throw e;
} finally {
  await browser.close();
  await pool.end();
}
