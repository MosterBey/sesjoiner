const asciiArt = `
\x1b[31m
【M】【O】【S】【T】【E】【R】【S】【H】【O】【P】\x1b[0m
\x1b[0m
`;
console.log(asciiArt);

const axios = require('axios');
const fs = require('fs');
const WebSocket = require('ws');
const config = require('./config.json');

const TOKENS_FILE = './tokens.txt';
const VALID_LOG = './valid.log';
const INVALID_LOG = './invalid.log';

function readTokens(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function short(tok) {
  if (!tok) return '';
  return `${tok.slice(0,6)}...${tok.slice(-6)}`;
}

async function tryCheck(token) {
  const endpoints = [
    { header: `Bot ${token}`, type: 'bot' },
    { header: token, type: 'user' }
  ];

  for (const attempt of endpoints) {
    try {
      const res = await axios.get('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: attempt.header },
        validateStatus: () => true,
        timeout: 7000
      });
      if (res.status === 200) {
        return { ok: true, type: attempt.type };
      } else if (res.status === 401) {
      } else {
        return { ok: false, code: res.status, statusText: res.statusText };
      }
    } catch (err) {
      return { ok: false, err: err.message };
    }
  }

  return { ok: false, code: 401 };
}

async function checkTokens(tokens) {
  const valid = [];
  try { fs.writeFileSync(VALID_LOG, ''); } catch {}
  try { fs.writeFileSync(INVALID_LOG, ''); } catch {}

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    console.log(`🔍 Token ${i+1} kontrol ediliyor: ${short(token)}`);
    const r = await tryCheck(token);
    if (r.ok) {
      console.log(`✅ Geçerli (${r.type}): ${short(token)}`);
      fs.appendFileSync(VALID_LOG, `${new Date().toISOString()} ${token} ${r.type}\n`);
      valid.push({ token, type: r.type });
    } else {
      console.error(`❌ Geçersiz veya hata (${r.code||r.err}): ${short(token)}`);
      fs.appendFileSync(INVALID_LOG, `${new Date().toISOString()} ${token} ${r.code||r.err}\n`);
    }
  }
  return valid;
}

function setPresence(ws, statusText, status = 'online') {
  ws.send(JSON.stringify({
    op: 3,
    d: {
      since: null,
      activities: [{ name: statusText, type: 0 }],
      status: status,
      afk: false
    }
  }));
}

function ws_joiner(tokenData, guildId, vcId, muted, deafen, video, stream, statusText) {
  const token = tokenData.token;
  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  let hb;

  const identify = {
    op: 2,
    d: {
      token: token,
      intents: 513,
      properties: { $os: 'linux', $browser: 'my_library', $device: 'my_library' }
    }
  };

  const vcPayload = {
    op: 4,
    d: {
      guild_id: guildId,
      channel_id: vcId,
      self_mute: muted,
      self_deaf: deafen,
      self_video: video
    }
  };

  const streamPayload = {
    op: 18,
    d: {
      type: "guild",
      guild_id: guildId,
      channel_id: vcId,
      preferred_region: "singapore"
    }
  };

  ws.on('open', () => {
    console.info(`🌐 WS açıldı: ${short(token)}`);
  });

  ws.on('message', (data) => {
    let payload;
    try { payload = JSON.parse(data); } catch (e) { return; }
    const { op, d, t } = payload;

    if (op === 10) {
      hb = setInterval(() => ws.send(JSON.stringify({ op: 1, d: null })), d.heartbeat_interval);
      ws.send(JSON.stringify(identify));
    }

    if (op === 0 && t === 'READY') {
      try {
        setPresence(ws, statusText, 'online');
        ws.send(JSON.stringify(vcPayload));
        console.info(`🎧 Başarılı: seste -> ${short(token)}`);
        if (stream) {
          setTimeout(() => {
            ws.send(JSON.stringify(streamPayload));
            console.log(`📺 Yayın isteği gönderildi: ${short(token)}`);
          }, 1000);
        }
      } catch (err) {
        console.error('VOICE JOIN ERROR:', err.message);
      }
    }

    if (op === 9) {
      console.warn(`⚠️ Gateway reject (invalid token?): ${short(token)} -> yeniden denenecek`);
      ws.close();
    }
  });

  ws.on('close', (code) => {
    clearInterval(hb);
    console.warn(`🔁 WS kapandı (${code}). 5s sonra yeniden bağlanacak: ${short(token)}`);
    setTimeout(() => ws_joiner(tokenData, guildId, vcId, muted, deafen, video, stream, statusText), 5000);
  });

  ws.on('error', (err) => {
    clearInterval(hb);
    console.error('WS HATA:', err.message);
  });
}

(async () => {
  try {
    const tokens = readTokens(TOKENS_FILE);
    if (!tokens.length) { console.error('tokens.txt boş veya bulunamadı.'); return; }

    const valid = await checkTokens(tokens);
    if (!valid.length) {
      console.error('🚫 Geçerli token bulunamadı. invalid.log kontrol et.');
      return;
    }

    for (const v of valid) {
      if (v.type === 'user') {
        console.warn(`⚠️ DİKKAT: ${short(v.token)} bir USER token olarak tespit edildi. Self-bot kullanımı Discord kurallarına aykırıdır.`);
      }
      ws_joiner(v, config.GUILD_ID, config.VC_CHANNEL, config.MUTED, config.DEAFEN, config.VIDEO, config.STREAM, config.ACTIVITY || 'MOSTERSHOP');
    }
  } catch (err) {
    console.error('Genel hata:', err);
  }
})();
