import { type Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { type Settings } from './config.js';
import { type Product, baseCosmetics, starterItems, combinedProducts } from './store-config.js';
import { ApiError, changed, getSettings, roomLock, transaction } from './db.js';
export function storeProducts(config: Settings): Product[] {
  // V8 IDs and their published prices remain valid; one inventory and one wallet.
  return combinedProducts(config.shop, config.store.products);
}
export class StoreService {
  constructor(readonly pool: Pool) {}
  async catalog() {
    const { config } = await getSettings(this.pool);
    return {
      title: config.store.title,
      products: storeProducts(config),
      dailyCoinCap: config.dailyCoinCap,
    };
  }
  async buy(userId: string, itemId: string, key: string, expectedPrice?: number) {
    await transaction(this.pool, async (tx) => {
      await roomLock(tx);
      const u = (await tx.query('SELECT coins FROM users WHERE id=$1 FOR UPDATE', [userId]))
        .rows[0];
      const previous = (
        await tx.query('SELECT item_id FROM store_commands WHERE user_id=$1 AND request_key=$2', [
          userId,
          key,
        ])
      ).rows[0];
      const legacy = (
        await tx.query(
          'SELECT outfit_id AS item_id FROM purchases WHERE user_id=$1 AND request_key=$2',
          [userId, key],
        )
      ).rows[0];
      if (previous || legacy) {
        if ((previous ?? legacy).item_id !== itemId)
          throw new ApiError(409, 'KEY_REUSED', 'Mã giao dịch đã được dùng cho vật phẩm khác.');
        return;
      }
      const { config } = await getSettings(tx),
        item = storeProducts(config).find((i) => i.id === itemId);
      if (!item) throw new ApiError(404, 'ITEM_MISSING', 'Không tìm thấy vật phẩm.');
      const owned =
        starterItems.includes(itemId) ||
        !!(
          await tx.query('SELECT 1 FROM inventory WHERE user_id=$1 AND outfit_id=$2', [
            userId,
            itemId,
          ])
        ).rowCount;
      if (!owned && !item.enabled)
        throw new ApiError(409, 'ITEM_UNAVAILABLE', 'Vật phẩm đang ngừng bán.');
      if (!owned && expectedPrice !== undefined && expectedPrice !== item.price)
        throw new ApiError(
          409,
          'PRICE_CHANGED',
          'Giá đã thay đổi. Hãy tải lại cửa hàng trước khi mua.',
        );
      const price = owned ? 0 : item.price;
      if (u.coins < price) throw new ApiError(409, 'INSUFFICIENT_COINS', 'Bạn chưa đủ xu.');
      await tx.query(
        'INSERT INTO store_commands(user_id,request_key,item_id,price) VALUES($1,$2,$3,$4)',
        [userId, key, itemId, price],
      );
      if (!owned) {
        await tx.query('UPDATE users SET coins=coins-$2 WHERE id=$1', [userId, price]);
        await tx.query('INSERT INTO inventory(user_id,outfit_id) VALUES($1,$2)', [userId, itemId]);
        await tx.query('INSERT INTO coin_ledger(user_id,amount,source) VALUES($1,$2,$3)', [
          userId,
          -price,
          `store:${userId}:${key}`,
        ]);
        await tx.query(
          'INSERT INTO purchases(id,user_id,outfit_id,amount,request_key) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), userId, itemId, price, key],
        );
        await changed(tx, 'appearance.changed', { userId });
      }
    });
  }
  async equip(userId: string, itemId: string) {
    await transaction(this.pool, async (tx) => {
      await roomLock(tx);
      await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const { config } = await getSettings(tx),
        item = storeProducts(config).find((i) => i.id === itemId);
      if (!item) throw new ApiError(404, 'ITEM_MISSING', 'Không tìm thấy vật phẩm.');
      if (
        !starterItems.includes(itemId) &&
        !(
          await tx.query('SELECT 1 FROM inventory WHERE user_id=$1 AND outfit_id=$2', [
            userId,
            itemId,
          ])
        ).rowCount
      )
        throw new ApiError(403, 'ITEM_NOT_OWNED', 'Bạn chưa sở hữu vật phẩm.');
      // Sale availability never revokes ownership or the right to equip.
      if (item.category === 'robe')
        await tx.query('UPDATE users SET equipped=$2 WHERE id=$1', [userId, itemId]);
      else {
        if (item.category === 'accessory')
          await tx.query("UPDATE users SET accessory='none' WHERE id=$1", [userId]);
        await tx.query(
          'UPDATE users SET cosmetics=jsonb_set(cosmetics,$2::text[],to_jsonb($3::text)) WHERE id=$1',
          [userId, [item.category], itemId],
        );
      }
      await changed(tx, 'appearance.changed', { userId });
    });
  }
  async history(userId: string) {
    return (
      await this.pool.query(
        'SELECT id,outfit_id AS item_id,amount,created_at FROM purchases WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 100',
        [userId],
      )
    ).rows;
  }
}
export { baseCosmetics };
