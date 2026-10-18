// Usage log (Supermaster view). IPs are stored truncated to two octets – enough to spot abuse, not a person.

export function shortIp(request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  return ip.split('.').slice(0, 2).join('.') + '.x.x';
}

export async function logAction(env, who, action, detail = '', request = null) {
  try {
    await env.DB.prepare('INSERT INTO usage_log (t, who, action, detail, ip) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(Date.now(), who || '-', action, String(detail || '').slice(0, 200), request ? shortIp(request) : null).run();
  } catch (e) { console.error('log failed', e); }
}

export async function listLog(env, limit = 200) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  const r = await env.DB.prepare('SELECT t, who, action, detail, ip FROM usage_log ORDER BY t DESC LIMIT ?1').bind(n).all();
  return r.results || [];
}
