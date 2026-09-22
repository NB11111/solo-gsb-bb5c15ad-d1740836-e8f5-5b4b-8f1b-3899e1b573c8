async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const analyze = (payload) => post('/api/analyze', payload);
export const recommend = (payload) => post('/api/recommend', payload);

export async function getModes() {
  const res = await fetch('/api/health');
  const data = await res.json();
  return data.modes;
}
