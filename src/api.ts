export async function api(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'X-Temple-Request': '1' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'Chưa thể kết nối. Vui lòng thử lại.'), {
      code: data.code,
      status: response.status,
    });
  return data;
}
export type Outfit = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  accent: string;
  price: number;
  collection: string;
};
export type User = {
  id: string;
  name: string;
  username: string;
  dharmaName: string;
  appearanceType: 'male' | 'female';
  hasRecoveryEmail: boolean;
  role: 'USER' | 'ADMIN' | 'OPERATOR' | 'MODERATOR';
  verified: boolean;
  coins: number;
  merit: number;
  dots: number;
  cosmetics: import('../server/store-config').Cosmetics;
  equipped: string;
  accessory: 'none' | 'beads' | 'lotus';
  inventory: string[];
};
