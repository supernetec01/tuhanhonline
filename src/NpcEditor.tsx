import { type Settings } from '../server/config';
import { standardSeatLayout } from '../server/npc-config';
export function NpcEditor({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (config: Settings) => void;
}) {
  return (
    <section className="admin-panel">
      <h2>Nhân vật thiền định NPC · V11</h2>
      <p>
        NPC là trang trí, không giữ ghế, không có tài khoản, không nhận xu/công đức và không tham
        gia chat hoặc dâng hương. Số người thật và NPC được hiển thị riêng.
      </p>
      <label>
        Chế độ NPC
        <select
          aria-label="Chế độ NPC"
          value={value.npc.mode}
          onChange={(e) =>
            onChange({
              ...value,
              npc: { ...value.npc, mode: e.target.value as Settings['npc']['mode'] },
            })
          }
        >
          <option value="fill">Tự động lấp ghế trống</option>
          <option value="half">Lấp 50% ghế trống</option>
          <option value="off">Tắt NPC</option>
        </select>
      </label>
      <label>
        Số NPC tối đa
        <input
          type="number"
          min="0"
          max="72"
          value={value.npc.maxCount}
          onChange={(e) =>
            onChange({ ...value, npc: { ...value.npc, maxCount: Number(e.target.value) } })
          }
        />
      </label>
      <label>
        Chuyển động NPC
        <select
          aria-label="Chuyển động NPC"
          value={value.npc.motion}
          onChange={(e) =>
            onChange({
              ...value,
              npc: { ...value.npc, motion: e.target.value as Settings['npc']['motion'] },
            })
          }
        >
          <option value="static">Tĩnh hoàn toàn</option>
          <option value="light">Nhẹ · 2 vái / 1 lạy mỗi đợt</option>
          <option value="medium">Trung bình · 4 vái / 2 lạy mỗi đợt</option>
        </select>
      </label>
      <p>
        Eco, giảm chuyển động và thiết bị mobile yếu dùng NPC tĩnh. Hình người thật luôn được ưu
        tiên.
      </p>
      <label>
        Fade nhường ghế (ms)
        <input
          type="number"
          min="300"
          max="500"
          value={value.npc.fadeMs}
          onChange={(e) =>
            onChange({ ...value, npc: { ...value.npc, fadeMs: Number(e.target.value) } })
          }
        />
      </label>
      <label>
        Xuất hiện lại sau khi ghế được giải phóng (giây)
        <input
          type="number"
          min="3"
          max="5"
          step=".5"
          value={value.npc.returnDelaySeconds}
          onChange={(e) =>
            onChange({
              ...value,
              npc: { ...value.npc, returnDelaySeconds: Number(e.target.value) },
            })
          }
        />
      </label>
      <h3>Sơ đồ 36 / 72 vị trí</h3>
      <p>
        Chọn sơ đồ sẽ thay tọa độ trong bản đang sửa. Chỉ xuất bản được khi không còn người giữ ghế.
        ID ghế A1–F6 và dữ liệu cũ được giữ nguyên; ghế mới G1–L6.
      </p>
      {([36, 72] as const).map((count) => (
        <button
          type="button"
          key={count}
          onClick={() =>
            onChange({ ...value, capacity: count, seatLayout: standardSeatLayout(count) })
          }
        >
          Dùng sơ đồ {count} vị trí
        </button>
      ))}
    </section>
  );
}
