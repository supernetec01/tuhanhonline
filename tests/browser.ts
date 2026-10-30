import { chromium, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
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
async function ready(p: Page) {
  await p.locator('.phaser-host[data-ready="true"]').waitFor({ timeout: 30000 });
  await expect(p.locator('.seat-target')).toHaveCount(36);
}
await mkdir('test-results', { recursive: true });
try {
  await page.goto(base);
  await ready(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/single-game.png' });
  await page.getByRole('button', { name: 'Ghế A3 trống', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await register(page, username, 'An Nhiên');
  await expect(page.locator('.dock-presence')).toContainText('A3', { timeout: 10000 });
  expect(new URL(page.url()).pathname).toBe('/');
  const u = (await pool.query('SELECT * FROM users WHERE username=$1', [username])).rows[0];
  expect(u.email).toBeNull();
  expect(u.verified_at).toBeNull();
  expect((await context.cookies()).some((c) => c.name === 'temple_session' && c.httpOnly)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Tủ đồ', exact: true }).click();
  await page.getByRole('button', { name: /Nắng ban mai/ }).click();
  await page.getByRole('button', { name: 'Chuỗi hạt', exact: true }).click();
  await expect(page.locator('.robe-preview [data-layer]')).toHaveCount(7);
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
  monitor(mobile);
  await mobile.goto(base);
  await ready(mobile);
  await mobile.getByRole('button', { name: 'Vào chánh điện', exact: true }).click();
  await register(mobile, `${username}_m`, 'Tâm An');
  await expect(mobile.getByRole('heading', { name: 'Xin chờ một duyên lành' })).toBeVisible({
    timeout: 10000,
  });
  expect(new URL(mobile.url()).pathname).toBe('/');
  await mobile.screenshot({ path: 'test-results/queue-popup.png' });
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: 'Đã có chỗ cho bạn' })).toBeVisible({
    timeout: 15000,
  });
  await mobile.getByRole('button', { name: 'Nhận chỗ ngồi', exact: true }).click();
  await expect(mobile.locator('.dock-presence')).toContainText('A3');
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
  await mobileContext.close();
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [u.id]);
  await page.goto(base + '/admin');
  await page.getByRole('button', { name: 'Thiết lập ứng dụng xác thực' }).click();
  const secret = await page.locator('.mfa-secret').innerText();
  await page
    .getByLabel('Mã xác thực', { exact: true })
    .fill(new TOTP({ secret: Secret.fromBase32(secret) }).generate());
  await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nội dung & cấu hình' })).toBeVisible();
  await page.getByLabel('Tên phòng', { exact: true }).fill('Chánh điện Phaser kiểm thử');
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã xuất bản');
  await page.getByRole('button', { name: 'Mô phỏng nhận quà', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã tiếp nhận');
  await page.getByRole('button', { name: 'Tạo phiên màn hình OBS · 30 phút' }).click();
  const href = await page.locator('.broadcast-link').getAttribute('href');
  const broadcast = await context.newPage();
  monitor(broadcast);
  await broadcast.goto(base + href);
  await broadcast.getByRole('button', { name: 'Bật nhận lời chúc / cho phép âm thanh' }).click();
  await expect(broadcast.locator('.broadcast-caption p')).toContainText('Cảm ơn', {
    timeout: 12000,
  });
  await broadcast.screenshot({ path: 'test-results/broadcast.png' });
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
  await broadcast.close();
  expect(errors).toEqual([]);
  console.log(
    'PASS: real Phaser canvas, 36 clickable seats, username/no-email auto-login, selected-seat grant, layered wardrobe/equip, ritual API, logout/case-insensitive login, full-room FIFO popup + invitation acceptance on mobile, audio/account popups without navigation, Admin MFA/publish and mock broadcast.',
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
