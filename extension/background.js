// Service worker da extensão: recebe o estado de cada aba de chat (content.js), traduz em eventos (translate.js) e
// manda para o Habblaud (POST <endereço>/api/events). Também avisa quando a aba fecha.
//
// Guardado em chrome.storage:
//   local.habblaudUrl   endereço do Habblaud (padrão DEFAULT_URL)
//   local.rooms         {"<provider>:<conversationId>": "Sala"} escolhidas no popup
//   session.tabs        {"<tabId>": último estado da aba}  (sobrevive ao service worker dormir)
//   session.status      {ok, at, error?} do último envio (o popup mostra)
importScripts('translate.js');
const { translate, closeEvents, convKey } = self.HabblaudTranslate;

const DEFAULT_URL = 'http://localhost:4848';

async function getUrl() {
  const { habblaudUrl } = await chrome.storage.local.get('habblaudUrl');
  return (habblaudUrl || DEFAULT_URL).replace(/\/+$/, '');
}

async function getRooms() {
  const { rooms } = await chrome.storage.local.get('rooms');
  return rooms || {};
}

async function getMembers() {
  const { members } = await chrome.storage.local.get('members');
  return members || {};
}

async function getTabs() {
  const { tabs } = await chrome.storage.session.get('tabs');
  return tabs || {};
}

async function setTab(tabId, state) {
  const tabs = await getTabs();
  if (state) tabs[tabId] = state;
  else delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
}

async function post(events) {
  if (!events.length) return;
  const url = await getUrl();
  try {
    const res = await fetch(`${url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    await chrome.storage.session.set({ status: { ok: true, at: Date.now() } });
  } catch (err) {
    await chrome.storage.session.set({ status: { ok: false, at: Date.now(), error: String(err && err.message ? err.message : err) } });
  }
}

/** Fila simples: os eventos saem na ordem em que as abas mudaram. */
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

async function onState(tabId, state) {
  const tabs = await getTabs();
  const prev = tabs[tabId];
  const rooms = await getRooms();
  const members = await getMembers();
  const key = convKey(state);
  await post(translate(prev, state, key ? rooms[key] : undefined, key ? members[key] : undefined));
  await setTab(tabId, state);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'state' && sender.tab && sender.tab.id !== undefined) {
    enqueue(() => onState(sender.tab.id, msg.state));
    reply({ ok: true });
    return false;
  }
  if (msg && msg.type === 'tab-info') {
    // Popup: o estado da aba ativa e a sala escolhida para a conversa dela.
    (async () => {
      const tabs = await getTabs();
      const state = tabs[msg.tabId];
      const rooms = await getRooms();
      const key = convKey(state);
      const { status } = await chrome.storage.session.get('status');
      const members = await getMembers();
      let team = [];
      try {
        const res = await fetch(`${await getUrl()}/api/team`);
        if (res.ok) team = (await res.json()).members || [];
      } catch {
        // Habblaud fora do ar: o popup mostra sem a lista da equipe.
      }
      reply({ state, room: key ? rooms[key] : undefined, member: key ? members[key] : undefined, team, rooms: [...new Set(Object.values(rooms))].sort(), url: await getUrl(), status });
    })();
    return true;
  }
  if (msg && msg.type === 'set-room') {
    // Popup: guarda a sala da conversa e já manda a pessoa para lá.
    enqueue(async () => {
      const tabs = await getTabs();
      const state = tabs[msg.tabId];
      const key = convKey(state);
      if (!key) return reply({ ok: false });
      const rooms = await getRooms();
      if (msg.room) rooms[key] = msg.room;
      else delete rooms[key];
      await chrome.storage.local.set({ rooms });
      await post([{ type: 'heartbeat', provider: state.provider, conversationId: state.conversationId, ...(state.title ? { title: state.title } : {}), ...(msg.room || state.project ? { room: msg.room || state.project } : {}) }]);
      reply({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === 'set-member') {
    // Popup: esta conversa é de um agente da equipe fixa (ou deixa de ser).
    enqueue(async () => {
      const tabs = await getTabs();
      const state = tabs[msg.tabId];
      const key = convKey(state);
      if (!key) return reply({ ok: false });
      const members = await getMembers();
      if (msg.member) members[key] = msg.member;
      else delete members[key];
      await chrome.storage.local.set({ members });
      if (!msg.member) await post([{ type: 'close', provider: state.provider, conversationId: state.conversationId }]);
      await post([{ type: 'open', provider: state.provider, conversationId: state.conversationId, ...(state.title ? { title: state.title } : {}), ...(msg.member ? { member: msg.member } : {}) }]);
      reply({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === 'set-url') {
    chrome.storage.local.set({ habblaudUrl: msg.url }).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const tabs = await getTabs();
    await post(closeEvents(tabs[tabId]));
    await setTab(tabId, undefined);
  });
});

// Instalou ou atualizou a extensão: as abas de chat já abertas ficaram com o script antigo desconectado (ele para de
// mandar sinal e a pessoa sai do escritório). Injeta o script de novo nelas, sem precisar recarregar as abas.
const CHAT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*', 'https://muse.ai/*', 'https://*.muse.ai/*'];
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: CHAT_URLS });
    for (const tab of tabs) {
      if (tab.id === undefined || tab.discarded) continue;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['sites.js', 'content.js'] }).catch(() => undefined);
    }
  } catch {
    // Sem abas ou sem permissão: elas voltam quando forem recarregadas.
  }
});
