// Roda dentro das páginas do ChatGPT, claude.ai e Gemini. Lê o estado da conversa (sites.js) a cada segundo e manda
// para o background quando muda, e de 25 em 25 segundos mesmo sem mudança (o "estou aqui" que mantém a pessoa no
// escritório). Nunca lê nem envia o conteúdo das mensagens: só o id da conversa, o título, o projeto e se a IA está
// gerando.
(function () {
  'use strict';
  // Injetado de novo pela mesma versão da extensão (ver background.js, onInstalled): não roda duas vezes.
  if (globalThis.__habblaudContent) return;
  globalThis.__habblaudContent = true;
  const { readState } = globalThis.HabblaudSites;
  const TICK_MS = 1_000;
  const HEARTBEAT_MS = 25_000;

  let last = '';
  let lastSentAt = 0;
  let stopped = false;

  function send(state) {
    try {
      chrome.runtime.sendMessage({ type: 'state', state }, () => void chrome.runtime.lastError);
    } catch {
      // A extensão foi atualizada ou desligada: esta página ficou com um script órfão. Para de tentar.
      stopped = true;
    }
  }

  function tick() {
    if (stopped) return;
    const state = readState(location, document);
    if (!state) return;
    const sig = JSON.stringify(state);
    const now = Date.now();
    if (sig !== last || now - lastSentAt >= HEARTBEAT_MS) {
      last = sig;
      lastSentAt = now;
      send(state);
    }
  }

  setInterval(tick, TICK_MS);
  tick();
})();
