import { storeProducts } from './store.js';
import { accrueCoins } from './economy.js';
import { type Pool } from 'pg';
import { ApiError, transaction, roomLock, getSettings, changed } from './db.js';
import { settingsSchema, type Settings } from './config.js';
export class CmsService {
  constructor(readonly pool: Pool) {}
  async state() {
    const draft = (
      await this.pool.query("SELECT id::text,config FROM config_revisions WHERE status='draft'")
    ).rows[0];
    if (draft) draft.config = settingsSchema.parse(draft.config);
    return {
      published: await getSettings(this.pool),
      draft: draft ?? null,
      revisions: (
        await this.pool.query(
          'SELECT id::text,status,created_at FROM config_revisions ORDER BY id DESC LIMIT 20',
        )
      ).rows,
    };
  }
  async save(userId: string, config: Settings, expectedId: string | null) {
    settingsSchema.parse(config);
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const previous = (await tx.query("SELECT * FROM config_revisions WHERE status='draft'"))
        .rows[0];
      if ((previous?.id?.toString() ?? null) !== expectedId)
        throw new ApiError(
          409,
          'DRAFT_CHANGED',
          'Bản nháp đã thay đổi. Hãy tải lại trước khi lưu.',
        );
      await tx.query("UPDATE config_revisions SET status='archived' WHERE status='draft'");
      const result = (
        await tx.query(
          "INSERT INTO config_revisions(status,config,created_by) VALUES('draft',$1,$2) RETURNING id::text",
          [JSON.stringify(config), userId],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO audit_logs(actor_id,action,before_json,after_json) VALUES($1,'config.draft',$2,$3)",
        [userId, previous?.config ?? null, JSON.stringify(config)],
      );
      return result;
    });
  }
  async publish(userId: string, id: string, rollback = false) {
    return transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const previous = await getSettings(tx);
      const candidate = (await tx.query('SELECT * FROM config_revisions WHERE id=$1', [id]))
        .rows[0];
      if (
        !candidate ||
        (!rollback && candidate.status !== 'draft') ||
        (rollback && candidate.status === 'draft')
      )
        throw new ApiError(409, 'INVALID_REVISION', 'Phiên bản không còn phù hợp.');
      const config = settingsSchema.parse(candidate.config);
      for (const id of [
        ...Object.values(config.audio),
        ...config.blessings.map((b) => b.audioId).filter(Boolean),
      ]) {
        const asset = (
          await tx.query('SELECT id,kind,duration_ms FROM media_assets WHERE id=$1', [id])
        ).rows[0];
        if (
          !asset ||
          (config.blessings.some((b) => b.audioId === id) &&
            (asset.kind !== 'voice' || asset.duration_ms > 10000))
        )
          throw new ApiError(
            400,
            'MEDIA_INVALID',
            'Bản thu không tồn tại hoặc voice vượt 10 giây.',
          );
      }
      const products = storeProducts(config),
        oldProducts = storeProducts(previous.config);
      for (const old of oldProducts) {
        const next = products.find((p) => p.id === old.id);
        if (!next) {
          if (
            (await tx.query('SELECT 1 FROM inventory WHERE outfit_id=$1 LIMIT 1', [old.id]))
              .rowCount
          )
            throw new ApiError(
              409,
              'ITEM_OWNED',
              'Vật phẩm đã có người sở hữu: hãy ngừng bán thay vì xóa.',
            );
        } else if (next.category !== old.category)
          throw new ApiError(409, 'ITEM_CATEGORY', 'Không đổi loại của ID vật phẩm đã xuất bản.');
      }
      for (const p of products)
        if (
          p.imageId &&
          !(await tx.query('SELECT 1 FROM shop_assets WHERE id=$1', [p.imageId])).rowCount
        )
          throw new ApiError(400, 'IMAGE_MISSING', 'Ảnh vật phẩm không tồn tại.');
      await accrueCoins(tx, previous.config, true);
      const changesSeats =
        config.capacity !== previous.config.capacity ||
        JSON.stringify(config.seatLayout) !==
          JSON.stringify(settingsSchema.parse(previous.config).seatLayout);
      if (
        changesSeats &&
        (await tx.query("SELECT 1 FROM room_entries WHERE status IN ('ACTIVE','INVITED') LIMIT 1"))
          .rowCount
      )
        throw new ApiError(
          409,
          'ROOM_NOT_EMPTY',
          'Chỉ đổi sơ đồ hoặc sức chứa khi không còn người giữ chỗ.',
        );
      await tx.query(
        "UPDATE config_revisions SET status='archived' WHERE status='published' OR (status='draft' AND id=$1)",
        [id],
      );
      const result = (
        await tx.query(
          "INSERT INTO config_revisions(status,config,created_by) VALUES('published',$1,$2) RETURNING id::text",
          [JSON.stringify(config), userId],
        )
      ).rows[0];
      await tx.query(
        'INSERT INTO audit_logs(actor_id,action,before_json,after_json) VALUES($1,$2,$3,$4)',
        [
          userId,
          rollback ? 'config.rollback' : 'config.publish',
          JSON.stringify(previous.config),
          JSON.stringify(config),
        ],
      );
      await changed(tx, 'config.published', { configVersion: result.id });
      return result;
    });
  }
}
