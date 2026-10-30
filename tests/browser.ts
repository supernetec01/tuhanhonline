import { chromium, expect } from '@playwright/test';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { TOTP, Secret } from 'otpauth';
import { connectDb } from '../server/db.js';
import { RoomService } from '../server/room.js';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const base = process.env.TEST_ORIGIN ?? 'http://localhost:3000';
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname) ||
  (process.env.MAIL_MODE ?? 'file') !== 'file'
)
  throw new Error('Browser test only runs against local development with file mail delivery.');
const pool = connectDb();
const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: 'reduce',
  }),
  page = await context.newPage();
const errors: string[] = [];
let id: string | undefined, restoreConfigId: string | undefined;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('response', (r) => {
  if (r.status() >= 500) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
});
const testRoomName = `Chánh điện UI ${Date.now().toString().slice(-6)}`;
const email = `ui-${Date.now()}@example.com`,
  password = 'Mat-khau-giao-dien-rieng-2026!';
await mkdir('test-results', { recursive: true });
try {
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Gác lại bộn bề, trở về an yên.' })).toBeVisible();
  await expect(page.locator('.seat')).toHaveCount(36);
  await page.getByRole('button', { name: 'Tạo tài khoản để lưu nhân vật' }).click();
  await page.getByLabel('Tên hiển thị').fill('An Nhiên');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.verification-note')).toBeVisible();
  id = (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  let verification: string | undefined;
  for (const name of await readdir(process.env.MAIL_OUTBOX_DIR ?? '.data/mail-outbox')) {
    const item = JSON.parse(
      await readFile(`${process.env.MAIL_OUTBOX_DIR ?? '.data/mail-outbox'}/${name}`, 'utf8'),
    );
    if (item.to === email && item.purpose === 'verify') verification = item.url;
  }
  expect(verification).toBeTruthy();
  await page.goto(verification!);
  await expect(page.locator('.verification-note')).toHaveCount(0);
  await expect(page.locator('.profile-card h2')).toHaveText('An Nhiên');
  await page.getByRole('button', { name: 'Ngồi tĩnh tâm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rời đệm ngồi' })).toBeVisible();
  await expect(page.locator('.your-seat .avatar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Chắp tay', exact: true }).click();
  await expect(page.locator('.your-seat .avatar-bow')).toBeVisible();
  const observerContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    }),
    observer = await observerContext.newPage();
  await observer.goto(base);
  await expect(observer.locator('.seat .avatar')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ghé tủ áo', exact: true }).click();
  await page.getByRole('button', { name: 'Nắng ban mai 180 xu' }).click();
  await page.getByRole('button', { name: 'Chuỗi hạt', exact: true }).click();
  await expect(page.locator('.large-avatar [data-layer]')).toHaveCount(7);
  await expect(page.locator('.large-avatar [data-layer="accessory"] circle')).toHaveCount(11);
  await page.getByRole('button', { name: 'Mặt sau', exact: true }).click();
  await expect(page.locator('.large-avatar [data-layer="hands"] path')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mặt trước', exact: true }).click();
  await expect(page.locator('.large-avatar [data-layer="hands"] path')).toHaveCount(1);
  await page.getByRole('button', { name: 'Sở hữu với 180 xu' }).click();
  await page.getByRole('button', { name: 'Xác nhận mua · 180 xu' }).click();
  await expect(page.locator('.wallet')).toHaveText('120 xu');
  await page.getByRole('button', { name: 'Mặc trang phục', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang mặc', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/wardrobe.png' });
  await page.keyboard.press('Escape');
  await expect(observer.locator('.seat .avatar[data-outfit="saffron"]')).toHaveCount(1);
  await expect(observer.locator('.seat [data-layer="accessory"] circle')).toHaveCount(11);
  await observerContext.close();
  await page.reload();
  await expect(page.locator('.profile-outfit')).toContainText('Nắng ban mai');
  await expect(page.locator('.coins-row strong')).toHaveText('120 xu');
  await expect(page.locator('.profile-card .avatar [data-layer="accessory"] circle')).toHaveCount(
    11,
  );
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  // Elevate only this known test fixture in the local DB; actual Admin HTTP still requires real MFA.
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [id]);
  await page.goto(base + '/admin');
  await page.getByRole('button', { name: 'Thiết lập ứng dụng xác thực' }).click();
  const secret = await page.locator('.mfa-secret').innerText();
  const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
  await page.getByLabel('Mã xác thực', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Xác thực', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nội dung & cấu hình' })).toBeVisible();
  restoreConfigId = (
    await pool.query("SELECT id::text FROM config_revisions WHERE status='published'")
  ).rows[0].id;
  await page.getByLabel('Tên phòng', { exact: true }).fill(testRoomName);
  await page.getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xuất bản', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã xuất bản');
  await page.getByRole('button', { name: 'Mô phỏng nhận quà', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã tiếp nhận');
  await page.getByRole('button', { name: 'Tải lại dữ liệu', exact: true }).click();
  await expect(page.locator('.tts-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Tạo phiên màn hình OBS · 30 phút' }).click();
  const href = await page.locator('.broadcast-link').getAttribute('href');
  expect(href).toBeTruthy();
  const broadcast = await context.newPage();
  await broadcast.goto(base + href);
  await broadcast.getByRole('button', { name: 'Bật nhận lời chúc / cho phép âm thanh' }).click();
  await expect(broadcast.locator('.broadcast-caption p')).toContainText('Cảm ơn');
  await broadcast.screenshot({ path: 'test-results/broadcast.png', fullPage: true });
  await page.getByRole('button', { name: 'Diễn tập thiền chung 60 giây' }).click();
  await expect(broadcast.locator('.ceremony-overlay')).toBeVisible();
  await broadcast.screenshot({ path: 'test-results/ceremony.png', fullPage: true });
  await page.getByRole('button', { name: 'Xem thống kê đo được' }).click();
  await expect(page.getByRole('status')).toContainText('Không có số lượt xem TikTok');
  await broadcast.close();
  await page.screenshot({ path: 'test-results/admin.png', fullPage: true });
  await page.goto(base);
  await expect(page.locator('.scene-heading')).toContainText(testRoomName);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page.locator('.profile-card h2')).toHaveText('Một người hữu duyên');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('dialog').getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.profile-outfit')).toContainText('Nắng ban mai');
  const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    }),
    mobile = await mobileContext.newPage();
  await mobile.goto(base);
  await mobile.evaluate(() => document.fonts.ready);
  await expect(mobile.locator('.seat')).toHaveCount(36);
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await mobile.getByRole('button', { name: 'Ghé tủ áo', exact: true }).click();
  await expect(mobile.getByRole('heading', { name: 'Tủ áo an nhiên' })).toBeVisible();
  await mobile.getByRole('button', { name: 'Hoa sen', exact: true }).click();
  await mobile.screenshot({ path: 'test-results/mobile-wardrobe.png' });
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobileContext.close();
  expect(errors).toEqual([]);
  console.log(
    'PASS: real seat join + viewer sync, verified registration, 7-layer wardrobe front/back/accessory + purchase/equip persistence, Admin MFA/draft/publish, mock LIVE/worker/broadcast captions, logout/login, desktop/mobile and no browser errors. AI audio and real TikTok not exercised.',
  );
} finally {
  await browser.close();
  if (id) {
    await pool.query(
      "UPDATE ceremony_runs SET status='COMPLETED',ends_at=clock_timestamp() WHERE created_by=$1 AND source='manual'",
      [id],
    );
    await new RoomService(pool).leave(id);
  }
  if (restoreConfigId && id) {
    const { CmsService } = await import('../server/cms.js');
    await new CmsService(pool).publish(id, restoreConfigId, true);
  }
  if (id) {
    await pool.query("UPDATE users SET role='USER',banned=true WHERE id=$1", [id]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
  }
  await pool.end();
}
