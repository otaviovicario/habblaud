// Popup: mostra a conversa da aba ativa, deixa escolher a sala dela e o endereço do Habblaud.
const NAMES = { chatgpt: 'ChatGPT', 'claude-web': 'Claude', gemini: 'Gemini', muse: 'Muse', web: 'IA' };
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
  // Equipe fixa: escolher de qual agente é esta conversa (vence o título). Com agente, a sala é a dele.
  const team = info.team || [];
  if (team.length) {
    $('member-box').hidden = false;
    const sel = $('member');
    for (const m of team) sel.append(Object.assign(document.createElement('option'), { value: m.name, textContent: `${m.name} (${m.role})` }));
    sel.value = info.member || '';
    $('room-box').hidden = !!info.member;
    $('member-hint').textContent = info.member ? `Esta conversa é do ${info.member}.` : 'Se esta conversa é de um agente da equipe, escolha qual.';
    $('save-member').onclick = async () => {
      await ask({ type: 'set-member', tabId: tab.id, member: sel.value });
      $('member-hint').textContent = sel.value ? `Pronto: esta conversa agora é do ${sel.value}.` : 'Pronto: esta conversa não é mais de um agente.';
      $('room-box').hidden = !!sel.value;
    };
  }
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
