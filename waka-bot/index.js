// Waka bot — assistente para grupos de WhatsApp
// Boas-vindas, anti-link, anti-spam, menu de comandos e gestão do grupo.
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const PHONE = (process.env.BOT_NUMBER || '258853806180').replace(/\D/g, '');
const PREFIX = process.env.PREFIX || '!';
const BOT_NAME = 'Waka bot';
const DATA = path.join(__dirname, 'dados.json');
const AUTH = path.join(__dirname, 'sessao');

// ---------- definições por grupo ----------
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { db = {}; }
const save = () => fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
const cfg = (gid) => {
  if (!db[gid]) {
    db[gid] = {
      boasvindas: true,
      adeus: true,
      antilink: true,
      antispam: true,
      msgBoasVindas: 'Olá @user 👋 Bem-vindo(a) ao *@grupo*! Lê as regras com *!regras* e vê os comandos com *!menu*.',
      msgAdeus: '@user saiu do grupo. Até à próxima 👋',
      regras: '1. Respeita todos os membros.\n2. Proibido links e spam.\n3. Nada de conteúdo ofensivo.\n4. Fala com os admins se tiveres dúvidas.',
      avisos: {},
      silenciados: [],
    };
    save();
  }
  return db[gid];
};

// ---------- anti-spam (memória) ----------
const flood = new Map(); // gid:user -> [timestamps]
const LIMITE_MSGS = 6, JANELA_MS = 10000, MAX_AVISOS = 3;
const LINK_RE = /(chat\.whatsapp\.com\/|https?:\/\/|www\.|wa\.me\/|t\.me\/|bit\.ly\/|\b[a-z0-9-]+\.(com|net|org|co\.mz|mz|io|link|xyz|me)\b)/i;

const textoDe = (m) =>
  m.message?.conversation ||
  m.message?.extendedTextMessage?.text ||
  m.message?.imageMessage?.caption ||
  m.message?.videoMessage?.caption || '';

const MENU = () => `╭━━━ 🤖 *${BOT_NAME}* ━━━
┃ _Seu assistente no grupo_
┃
┃ 👥 *Para todos*
┃ ${PREFIX}menu — este menu
┃ ${PREFIX}regras — regras do grupo
┃ ${PREFIX}info — informações do grupo
┃ ${PREFIX}admins — chamar os admins
┃ ${PREFIX}ping — ver se estou online
┃
┃ 🛡️ *Só admins*
┃ ${PREFIX}todos [texto] — marcar todos
┃ ${PREFIX}ban @membro — remover
┃ ${PREFIX}add 2588XXXXXXXX — adicionar
┃ ${PREFIX}promover @membro — dar admin
┃ ${PREFIX}rebaixar @membro — tirar admin
┃ ${PREFIX}aviso @membro — dar aviso (3 = remove)
┃ ${PREFIX}limparavisos @membro
┃ ${PREFIX}silenciar @membro / ${PREFIX}dessilenciar @membro
┃ ${PREFIX}fechar — só admins falam
┃ ${PREFIX}abrir — todos falam
┃ ${PREFIX}apagar — (responde à msg) apaga
┃ ${PREFIX}setregras [texto]
┃ ${PREFIX}setboasvindas [texto] (@user @grupo)
┃ ${PREFIX}setadeus [texto]
┃ ${PREFIX}antilink on/off
┃ ${PREFIX}antispam on/off
┃ ${PREFIX}boasvindas on/off
┃ ${PREFIX}config — ver definições
╰━━━ _Waka bot, sempre com você!_ ━━━`;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  });
  sock.ev.on('creds.update', saveCreds);

  // Ligação por código (sem QR): WhatsApp > Dispositivos ligados > Ligar com número
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE);
        const fmt = code.match(/.{1,4}/g).join('-');
        console.log(`\n🔑 CÓDIGO DE LIGAÇÃO para +${PHONE}: ${fmt}\n`);
        fs.writeFileSync(path.join(__dirname, 'codigo.txt'), fmt);
      } catch (e) { console.log('Erro ao pedir código:', e.message); }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log(`✅ ${BOT_NAME} ligado como +${PHONE}`);
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Sessão terminada. Apaga a pasta "sessao" e liga de novo.');
      } else {
        console.log('🔄 A religar...'); setTimeout(start, 3000);
      }
    }
  });

  // ---------- entradas / saídas ----------
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    try {
      const c = cfg(id);
      const meta = await sock.groupMetadata(id);
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id;
        const tag = '@' + jid.split('@')[0];
        if (action === 'add' && c.boasvindas) {
          const txt = c.msgBoasVindas.replace(/@user/g, tag).replace(/@grupo/g, meta.subject);
          await sock.sendMessage(id, { text: txt, mentions: [jid] });
        }
        if (action === 'remove' && c.adeus) {
          const txt = c.msgAdeus.replace(/@user/g, tag).replace(/@grupo/g, meta.subject);
          await sock.sendMessage(id, { text: txt, mentions: [jid] });
        }
      }
    } catch (e) { console.log('participants:', e.message); }
  });

  // ---------- mensagens ----------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try { await handle(sock, m); } catch (e) { console.log('msg:', e.message); }
    }
  });
}

async function handle(sock, m) {
  if (!m.message || m.key.fromMe) return;
  const from = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender = m.key.participant || from;
  const text = textoDe(m).trim();
  const reply = (t, mentions = []) => sock.sendMessage(from, { text: t, mentions }, { quoted: m });

  if (!isGroup) {
    if (text.toLowerCase().startsWith(PREFIX + 'menu') || /^(oi|olá|ola|menu)$/i.test(text))
      return reply(`Olá! 👋 Sou o *${BOT_NAME}*. Adiciona-me a um grupo e dá-me admin para eu ajudar.\n\n` + MENU());
    return;
  }

  const c = cfg(from);
  const meta = await sock.groupMetadata(from);
  const admins = meta.participants.filter((p) => p.admin).map((p) => p.id);
  const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  const botLid = sock.user.lid ? sock.user.lid.split(':')[0] + '@lid' : null;
  const isAdmin = admins.includes(sender);
  const botAdmin = admins.includes(botJid) || (botLid && admins.includes(botLid));
  const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const quotedP = m.message?.extendedTextMessage?.contextInfo?.participant;
  const alvo = mentioned[0] || quotedP;
  const del = () => sock.sendMessage(from, { delete: m.key }).catch(() => {});

  const avisar = async (jid, motivo) => {
    c.avisos[jid] = (c.avisos[jid] || 0) + 1; save();
    const n = c.avisos[jid];
    const tag = '@' + jid.split('@')[0];
    if (n >= MAX_AVISOS && botAdmin) {
      await sock.sendMessage(from, { text: `🚫 ${tag} chegou a ${MAX_AVISOS} avisos (${motivo}) e foi removido.`, mentions: [jid] });
      await sock.groupParticipantsUpdate(from, [jid], 'remove');
      delete c.avisos[jid]; save();
    } else {
      await sock.sendMessage(from, { text: `⚠️ ${tag}, aviso ${n}/${MAX_AVISOS}: ${motivo}.`, mentions: [jid] });
    }
  };

  // membros silenciados: mensagem apagada
  if (!isAdmin && c.silenciados.includes(sender) && botAdmin) return del();

  // anti-link
  if (c.antilink && !isAdmin && LINK_RE.test(text)) {
    if (botAdmin) await del();
    return avisar(sender, 'links não são permitidos');
  }

  // anti-spam (flood)
  if (c.antispam && !isAdmin) {
    const k = from + sender, now = Date.now();
    const arr = (flood.get(k) || []).filter((t) => now - t < JANELA_MS);
    arr.push(now); flood.set(k, arr);
    if (arr.length > LIMITE_MSGS) {
      flood.set(k, []);
      if (botAdmin) await del();
      return avisar(sender, 'spam / muitas mensagens seguidas');
    }
  }

  if (!text.startsWith(PREFIX)) return;
  const [cmdRaw, ...rest] = text.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();
  const arg = rest.join(' ');
  const soAdmin = () => { reply('🛡️ Só admins podem usar este comando.'); return false; };
  const precisaBotAdmin = () => { reply('Preciso de ser *admin* do grupo para fazer isso.'); return false; };
  const onoff = (campo, nome) => {
    if (!/^(on|off)$/i.test(arg)) return reply(`Usa: ${PREFIX}${cmd} on  ou  ${PREFIX}${cmd} off`);
    c[campo] = arg.toLowerCase() === 'on'; save();
    return reply(`${nome}: ${c[campo] ? '✅ ligado' : '❌ desligado'}`);
  };

  switch (cmd) {
    case 'menu': case 'ajuda': case 'help': return reply(MENU());
    case 'ping': return reply('🏓 Online, a funcionar 24h!');
    case 'regras': return reply(`📜 *Regras de ${meta.subject}*\n\n${c.regras}`);
    case 'info':
      return reply(`ℹ️ *${meta.subject}*\n👥 Membros: ${meta.participants.length}\n🛡️ Admins: ${admins.length}\n🔗 Anti-link: ${c.antilink ? 'on' : 'off'}\n🚫 Anti-spam: ${c.antispam ? 'on' : 'off'}${meta.desc ? `\n\n📝 ${meta.desc}` : ''}`);
    case 'admins':
      return reply('📣 Admins chamados:\n' + admins.map((a) => '@' + a.split('@')[0]).join(' '), admins);
  }

  // ---- comandos de admin ----
  if (!isAdmin) return soAdmin();
  switch (cmd) {
    case 'todos': case 'marcar': {
      const all = meta.participants.map((p) => p.id);
      return sock.sendMessage(from, { text: `📢 ${arg || 'Atenção, pessoal!'}\n\n` + all.map((a) => '@' + a.split('@')[0]).join(' '), mentions: all });
    }
    case 'ban': case 'remover': case 'kick':
      if (!botAdmin) return precisaBotAdmin();
      if (!alvo) return reply(`Marca o membro: ${PREFIX}ban @membro`);
      if (admins.includes(alvo)) return reply('Não posso remover um admin.');
      await sock.groupParticipantsUpdate(from, [alvo], 'remove');
      return reply('✅ Removido.');
    case 'add': {
      if (!botAdmin) return precisaBotAdmin();
      const n = arg.replace(/\D/g, '');
      if (n.length < 9) return reply(`Usa: ${PREFIX}add 2588XXXXXXXX`);
      const r = await sock.groupParticipantsUpdate(from, [n + '@s.whatsapp.net'], 'add');
      return reply(r?.[0]?.status === '200' ? '✅ Adicionado.' : '⚠️ Não consegui adicionar (privacidade do número). Envia-lhe o link do grupo.');
    }
    case 'promover':
      if (!botAdmin) return precisaBotAdmin();
      if (!alvo) return reply(`Marca o membro: ${PREFIX}promover @membro`);
      await sock.groupParticipantsUpdate(from, [alvo], 'promote');
      return reply('✅ Agora é admin.');
    case 'rebaixar':
      if (!botAdmin) return precisaBotAdmin();
      if (!alvo) return reply(`Marca o membro: ${PREFIX}rebaixar @membro`);
      await sock.groupParticipantsUpdate(from, [alvo], 'demote');
      return reply('✅ Já não é admin.');
    case 'aviso':
      if (!alvo) return reply(`Marca o membro: ${PREFIX}aviso @membro`);
      return avisar(alvo, arg.replace(/@\d+/g, '').trim() || 'aviso de um admin');
    case 'limparavisos':
      if (!alvo) return reply(`Marca o membro: ${PREFIX}limparavisos @membro`);
      delete c.avisos[alvo]; save(); return reply('✅ Avisos limpos.');
    case 'silenciar':
      if (!alvo) return reply(`Marca o membro: ${PREFIX}silenciar @membro`);
      if (!c.silenciados.includes(alvo)) c.silenciados.push(alvo); save();
      return reply('🔇 Membro silenciado: as mensagens dele serão apagadas.');
    case 'dessilenciar':
      if (!alvo) return reply(`Marca o membro: ${PREFIX}dessilenciar @membro`);
      c.silenciados = c.silenciados.filter((j) => j !== alvo); save();
      return reply('🔊 Membro pode falar de novo.');
    case 'fechar':
      if (!botAdmin) return precisaBotAdmin();
      await sock.groupSettingUpdate(from, 'announcement');
      return reply('🔒 Grupo fechado: só admins enviam mensagens.');
    case 'abrir':
      if (!botAdmin) return precisaBotAdmin();
      await sock.groupSettingUpdate(from, 'not_announcement');
      return reply('🔓 Grupo aberto: todos podem falar.');
    case 'apagar': {
      if (!botAdmin) return precisaBotAdmin();
      const ctx = m.message?.extendedTextMessage?.contextInfo;
      if (!ctx?.stanzaId) return reply('Responde à mensagem que queres apagar com !apagar');
      await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: ctx.stanzaId, participant: ctx.participant } });
      return del();
    }
    case 'setregras':
      if (!arg) return reply(`Usa: ${PREFIX}setregras 1. ... 2. ...`);
      c.regras = arg; save(); return reply('✅ Regras atualizadas.');
    case 'setboasvindas':
      if (!arg) return reply(`Usa: ${PREFIX}setboasvindas Olá @user, bem-vindo ao @grupo!`);
      c.msgBoasVindas = arg; save(); return reply('✅ Mensagem de boas-vindas atualizada.');
    case 'setadeus':
      if (!arg) return reply(`Usa: ${PREFIX}setadeus @user saiu.`);
      c.msgAdeus = arg; save(); return reply('✅ Mensagem de saída atualizada.');
    case 'antilink': return onoff('antilink', '🔗 Anti-link');
    case 'antispam': return onoff('antispam', '🚫 Anti-spam');
    case 'boasvindas': return onoff('boasvindas', '👋 Boas-vindas');
    case 'adeus': return onoff('adeus', '👋 Mensagem de saída');
    case 'config':
      return reply(`⚙️ *Definições*\nBoas-vindas: ${c.boasvindas ? 'on' : 'off'}\nSaída: ${c.adeus ? 'on' : 'off'}\nAnti-link: ${c.antilink ? 'on' : 'off'}\nAnti-spam: ${c.antispam ? 'on' : 'off'}\nSilenciados: ${c.silenciados.length}\nBot é admin: ${botAdmin ? 'sim' : 'NÃO'}`);
    default:
      return reply(`Comando desconhecido. Vê ${PREFIX}menu`);
  }
}

start();
