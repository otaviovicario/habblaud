// Popup: mostra a conversa da aba ativa, deixa escolher a sala dela e o endereço do Habblaud.
const NAMES = { chatgpt: 'ChatGPT', 'claude-web': 'Claude', gemini: 'Gemini', web: 'IA' };
const $ = (id) => document.getElementById(id);

function ask(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? undefined : r)));
}

function ago(at) {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? `há ${s} s` : `há ${Math.round(s / 60)} min`;
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const info = (tab && (await ask({ type: 'tab-info', tabId: tab.id }))) || {};
  const s = info.state;

  $('url').value = info.url || '';
  const st = info.status;
  $('dot').className = `dot${st ? (st.ok ? ' ok' : ' err') : ''}`;
  $('status-text').textContent = !st
    ? 'Nenhum envio ainda'
    : st.ok
      ? `Conectado (último envio ${ago(st.at)})`
      : `Sem conexão: ${st.error || 'erro'}. O Habblaud está rodando nesse endereço?`;

  if (!s || !s.conversationId) return;
  $('conv-empty').hidden = true;
  $('conv-info').hidden = false;
  $('room-box').hidden = false;
  $('conv-provider').textContent = `${NAMES[s.provider] || s.provider}${s.generating ? ' · respondendo agora' : ''}`;
  $('conv-title').textContent = s.title || 'Conversa sem título';
  $('room').value = info.room || '';
  $('room').placeholder = s.project || 'Ex.: Statlys';
  $('room-hint').textContent = info.room
    ? ''
    : s.project
      ? `Sem sala escolhida: vai para "${s.project}" (o projeto no site).`
      : 'Sem sala escolhida: vai para "Conversas".';
  const list = $('rooms');
  list.replaceChildren(...(info.rooms || []).map((r) => Object.assign(document.createElement('option'), { value: r })));

  $('save-room').onclick = async () => {
    const room = $('room').value.replace(/[\\/]+/g, '-').trim().slice(0, 40);
    await ask({ type: 'set-room', tabId: tab.id, room });
    $('room-hint').textContent = room ? `Pronto: esta conversa agora fica na sala "${room}".` : 'Sala apagada.';
  };
}

$('save-url').onclick = async () => {
  const url = $('url').value.trim();
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    $('status-text').textContent = 'Use um endereço local, como http://localhost:4848';
    return;
  }
  await ask({ type: 'set-url', url });
  $('status-text').textContent = 'Endereço salvo.';
};

load();
