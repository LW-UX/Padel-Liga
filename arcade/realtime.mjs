// Supabase's documented Phoenix 1.0 JSON protocol. No database or auth session.
// https://supabase.com/docs/guides/realtime/protocol
export function connectRealtime(config, code, { onMessage, onStatus }, Socket = WebSocket) {
  if (!config?.url || !config?.publishableKey) throw new Error('Online-Spiele sind noch nicht eingerichtet.');
  const url = new URL('/realtime/v1/websocket', config.url);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('apikey', config.publishableKey);
  url.searchParams.set('vsn', '1.0.0');
  const topic = `realtime:padelarcade-v1-${code}`;
  let socket, closed = false, joined = false, ref = 0, retry, heartbeat, timeout, pendingHeartbeat;
  function stopTimers() { clearTimeout(timeout); clearInterval(heartbeat); }
  function send(event, payload, channel = topic) {
    if (socket?.readyState !== 1 || socket.bufferedAmount > 65536) return false;
    socket.send(JSON.stringify({ topic: channel, event, payload, ref: String(++ref), ...(channel === topic ? { join_ref: '1' } : {}) }));
    return String(ref);
  }
  function open() {
    if (closed) return;
    ref = 0; joined = false; pendingHeartbeat = null;
    socket = new Socket(url.href);
    const current = socket;
    timeout = setTimeout(() => current.close(), 8000);
    current.onopen = () => send('phx_join', { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false } });
    current.onmessage = event => {
      if (closed || current !== socket || typeof event.data !== 'string' || event.data.length > 32768) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.topic === 'phoenix' && message.ref === pendingHeartbeat) { pendingHeartbeat = null; return; }
      if (message.topic !== topic) return;
      if (message.event === 'phx_reply' && message.ref === '1' && !joined) {
        if (message.payload?.status !== 'ok') { current.close(); return; }
        clearTimeout(timeout); joined = true;
        heartbeat = setInterval(() => {
          if (pendingHeartbeat) { current.close(); return; }
          pendingHeartbeat = send('heartbeat', {}, 'phoenix');
        }, 20000);
        onStatus(true);
      } else if (message.event === 'broadcast' && message.payload?.event === 'game' && joined) {
        onMessage(message.payload.payload);
      } else if (message.event === 'phx_error' || message.event === 'phx_close') current.close();
    };
    current.onerror = () => current.close();
    current.onclose = () => {
      if (current !== socket) return;
      joined = false; stopTimers();
      if (!closed) { onStatus(false); retry = setTimeout(open, 1000); }
    };
  }
  open();
  return {
    send(payload) { return joined && Boolean(send('broadcast', { type: 'broadcast', event: 'game', payload })); },
    close() { closed = true; joined = false; clearTimeout(retry); stopTimers(); socket?.close(); }
  };
}
