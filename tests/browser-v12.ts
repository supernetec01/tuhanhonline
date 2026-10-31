import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectDb } from '../server/db.js';
import { RoomService } from '../server/room.js';
import { defaultSettings } from '../server/config.js';
import { standardSeatLayout } from '../server/npc-config.js';
if (!process.env.REDIS_KEY_PREFIX?.startsWith('browser_'))
  throw new Error('Use isolated browser-runner --v12');
const pool = connectDb(),
  room = new RoomService(pool),
  base = process.env.TEST_ORIGIN!;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
await context.addInitScript(() => {
  const Native = window.WebSocket;
  (window as any).__movementEvents = [];
  (window as any).WebSocket = class extends Native {
    constructor(...args: any[]) {
      super(args[0], args[1]);
      this.addEventListener('message', (e) => {
        if (typeof e.data === 'string' && e.data.includes('character.move.started'))
          (window as any).__movementEvents.push(Date.now());
      });
    }
  };
});
async function current(id: string) {
  return (await pool.query("SELECT * FROM room_entries WHERE user_id=$1 AND status='ACTIVE'", [id]))
    .rows[0];
}
const metrics: any = {
  environment:
    'Headless Chromium on managed cloud; mobile viewport emulation, not physical-device measurements',
};
try {
  await mkdir('test-results', { recursive: true });
  const loadStart = performance.now();
  await page.goto(base);
  await page.locator('.phaser-host[data-ready="true"]').waitFor({ timeout: 45000 });
  metrics.initialAtlasLoadMs = performance.now() - loadStart;
  expect(
    Number(await page.locator('.phaser-host').getAttribute('data-rig-frames')),
  ).toBeGreaterThan(40);
  metrics.rigAtlasBytes = Number(await page.locator('.phaser-host').getAttribute('data-rig-bytes'));
  await page.getByRole('button', { name: 'Ghế A3 trống', exact: true }).click();
  const username = 'v12_' + Date.now().toString(36),
    password = 'V12-private-browser-test!';
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(username);
  await page.getByLabel('Pháp danh', { exact: true }).fill('Liên An');
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Kiểu nhân vật', { exact: true }).selectOption('female');
  await page.getByRole('button', { name: 'Tạo tài khoản & bước vào', exact: true }).click();
  await expect(page.locator('.dock-presence')).toContainText('A3', { timeout: 15000 });
  const user = (await pool.query('SELECT * FROM users WHERE username=$1', [username])).rows[0];
  expect(user.appearance_type).toBe('female');
  expect(user.email).toBeNull();
  await page.getByRole('button', { name: 'Tủ đồ', exact: true }).click();
  await expect(page.locator('.robe-preview svg[data-appearance="female"]')).toHaveCount(1);
  for (const part of ['armLeft', 'armRight', 'legLeft', 'legRight'])
    await expect(page.locator(`.robe-preview [data-layer="${part}"]`)).toHaveCount(1);
  await page.screenshot({ path: 'test-results/v12-female-wardrobe.png' });
  await page.getByRole('button', { name: 'Đóng cửa sổ', exact: true }).click();
  await page.getByRole('button', { name: 'Đi dạo', exact: true }).click();
  await expect(page.locator('.walkway-targets button')).not.toHaveCount(0);
  const commandStart = Date.now();
  await page.getByRole('button', { name: 'Đi tới walk:0:left', exact: true }).click();
  await expect.poll(async () => (await current(user.id))?.character_state).toBe('WALKING_AWAY');
  const walking = await current(user.id);
  expect(new Date(walking.leave_deadline).getTime() - Date.now()).toBeGreaterThan(175000);
  metrics.moveCommandMs = Date.now() - commandStart;
  await expect
    .poll(async () => page.evaluate(() => (window as any).__movementEvents.length), {
      timeout: 10000,
    })
    .toBeGreaterThan(0);
  metrics.socketEventDeliveryMs =
    (await page.evaluate(() => (window as any).__movementEvents[0])) - commandStart;
  await page.screenshot({ path: 'test-results/v12-walking.png' });
  await expect
    .poll(async () => (await current(user.id))?.character_state, {
      timeout: 30000,
      intervals: [250],
    })
    .toBe('STANDING');
  const deadline = String((await current(user.id)).leave_deadline);
  await pool.query(
    "UPDATE room_entries SET reward_cursor=clock_timestamp()-interval '5 minutes' WHERE user_id=$1",
    [user.id],
  );
  await room.tick();
  expect((await pool.query('SELECT coins FROM users WHERE id=$1', [user.id])).rows[0].coins).toBe(
    300,
  );
  await page.reload();
  await page.locator('.phaser-host[data-ready="true"]').waitFor({ timeout: 45000 });
  expect(String((await current(user.id)).leave_deadline)).toBe(deadline);
  await page.getByRole('button', { name: 'Về ghế', exact: true }).click();
  await expect
    .poll(async () => (await current(user.id))?.character_state, {
      timeout: 30000,
      intervals: [250],
    })
    .toBe('SEATED');
  expect((await current(user.id)).leave_deadline).toBeNull();
  // A complete real-time ceremony: the five-second burn excludes walking and queue time.
  await page.getByRole('button', { name: 'Dâng hương', exact: true }).click();
  await expect
    .poll(async () => (await room.myAction(user.id))?.status, { timeout: 45000, intervals: [300] })
    .toBe('RUNNING');
  const ritual = await room.myAction(user.id);
  expect(new Date(ritual!.ends_at).getTime() - new Date(ritual!.started_at).getTime()).toBe(5000);
  await page.screenshot({ path: 'test-results/v12-incense-active.png' });
  await expect
    .poll(async () => (await current(user.id))?.character_state, {
      timeout: 45000,
      intervals: [300],
    })
    .toBe('SEATED');
  expect((await pool.query('SELECT merit FROM users WHERE id=$1', [user.id])).rows[0].merit).toBe(
    10,
  );
  // Populate only this isolated schema; these are fixtures, not fabricated live users.
  const config = {
    ...structuredClone(defaultSettings),
    capacity: 72,
    seatLayout: standardSeatLayout(72),
  };
  await pool.query("UPDATE config_revisions SET config=$1 WHERE status='published'", [
    JSON.stringify(config),
  ]);
  for (let i = 0; i < 71; i++) {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users(id,name,password_hash,username,appearance_type,equipped)VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        `Đạo hữu thử ${i + 1}`,
        user.password_hash,
        'f_' + randomBytes(8).toString('hex'),
        i % 2 ? 'male' : 'female',
        ['linen', 'saffron', 'lotus', 'cloud'][i % 4],
      ],
    );
    await room.join(id, randomUUID());
  }
  await expect(page.locator('.game-room-count')).toContainText('72/72', { timeout: 15000 });
  await page.getByRole('button', { name: 'Toàn cảnh', exact: true }).click();
  await page.screenshot({ path: 'test-results/v12-72-desktop.png' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const collect = async () => {
    const m = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(m.metrics.map((m) => [m.name, m.value]));
  };
  const before = await collect(),
    start = Date.now();
  const fps: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1000);
    fps.push(Number(await page.locator('.phaser-host').getAttribute('data-fps')));
  }
  const after = await collect();
  metrics.desktop72 = {
    fpsSamples: fps,
    meanPhaserFps: fps.reduce((a, b) => a + b, 0) / fps.length,
    jsHeapBytes: after.JSHeapUsedSize,
    rendererTaskCpuFraction:
      (after.TaskDuration - before.TaskDuration) / ((Date.now() - start) / 1000),
  };
  await page.getByRole('button', { name: 'Theo tôi', exact: true }).click();
  await expect(page.locator('.camera-tools')).toContainText('1.80');
  await page.screenshot({ path: 'test-results/v12-camera-close.png' });
  await page.getByRole('button', { name: 'Toàn cảnh', exact: true }).click();
  // Stop the desktop renderer before measuring the mobile viewport on the same CPU.
  await page.goto('about:blank');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  mobile.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  mobile.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await mobile.goto(base);
  await mobile.locator('.phaser-host[data-ready="true"]').waitFor({ timeout: 45000 });
  await expect(mobile.locator('.game-room-count')).toContainText('72/72');
  const mfps: number[] = [];
  for (let i = 0; i < 5; i++) {
    await mobile.waitForTimeout(1000);
    mfps.push(Number(await mobile.locator('.phaser-host').getAttribute('data-fps')));
  }
  metrics.mobileEmulation72 = {
    fpsSamples: mfps,
    meanPhaserFps: mfps.reduce((a, b) => a + b, 0) / mfps.length,
    jsHeapBytes: await mobile.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? null),
  };
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: 'test-results/v12-72-mobile.png' });
  await mobileContext.close();
  expect(errors).toEqual([]);
  await writeFile('test-results/v12-browser-metrics.json', JSON.stringify(metrics, null, 2));
  console.log(
    'PASS V12: female signup/robe rig, server walk and return, reconnect deadline, paused coins, real-time five-second incense + one merit award, 72 actors, camera, desktop/mobile metrics and no browser errors.',
  );
} catch (error) {
  console.error(
    'Browser diagnostics',
    JSON.stringify({ errors, view: (await page.locator('body').innerText()).slice(-1200) }),
  );
  await page.screenshot({ path: 'test-results/v12-failure.png' }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await pool.end();
}
