// Traduz o estado de uma aba (vindo do content.js) nos eventos do POST /api/events. Função pura: usada pelo
// background.js e pelos testes em Node (extension/sites.test.mjs).
//
//   prev  = último estado conhecido da aba (ou undefined)
//   state = estado novo: {provider, conversationId?, title?, project?, generating?}
//   room  = sala escolhida para essa conversa no popup (ou undefined: vale o projeto do site, depois a do servidor)
//   member = agente da equipe fixa escolhido no popup para essa conversa (ou undefined: o servidor tenta pelo título)
(function (root) {
  'use strict';

  function convKey(s) {
    return s && s.conversationId ? `${s.provider}:${s.conversationId}` : undefined;
  }

  function base(s, room, member) {
    const ev = { provider: s.provider, conversationId: s.conversationId };
    if (s.title) ev.title = s.title;
    if (member) ev.member = member;
    const r = room || s.project;
    if (r) ev.room = r;
    return ev;
  }

  function translate(prev, state, room, member) {
    const events = [];
    const prevKey = convKey(prev);
    const key = convKey(state);
    if (prevKey && prevKey !== key) {
      events.push({ type: 'close', provider: prev.provider, conversationId: prev.conversationId });
    }
    if (!key) return events;
    if (prevKey !== key) {
      events.push({ type: 'open', ...base(state, room, member) });
      if (state.generating) events.push({ type: 'activity', ...base(state, room, member), activity: { kind: 'respond', text: 'Escrevendo a resposta' } });
      return events;
    }
    if (state.generating && !prev.generating) {
      events.push({ type: 'activity', ...base(state, room, member), activity: { kind: 'respond', text: 'Escrevendo a resposta' } });
    } else if (!state.generating && prev.generating) {
      events.push({ type: 'status', ...base(state, room, member), status: 'idle' });
    } else {
      events.push({ type: 'heartbeat', ...base(state, room, member) });
    }
    return events;
  }

  /** Eventos ao fechar a aba. */
  function closeEvents(prev) {
    return convKey(prev) ? [{ type: 'close', provider: prev.provider, conversationId: prev.conversationId }] : [];
  }

  root.HabblaudTranslate = { translate, closeEvents, convKey };
})(typeof globalThis !== 'undefined' ? globalThis : this);
