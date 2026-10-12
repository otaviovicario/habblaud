// O que a extensão sabe de cada site de chat: como achar o id da conversa na URL, o título, o projeto (sala sugerida)
// e se a IA está gerando uma resposta agora. Funções puras sobre `location` e `document`, carregadas antes do
// content.js e também pelos testes em Node (extension/sites.test.mjs).
//
// Os sites mudam o HTML sem aviso: por isso cada detecção tenta vários caminhos (atributos de teste, rótulos de
// acessibilidade em inglês e português) e, se nada bater, a conversa continua presente, só sem o "trabalhando".
(function (root) {
  'use strict';

  /** Rótulo de um botão de "parar resposta" (o sinal mais estável de que a IA está gerando). */
  const STOP_LABEL = /^(stop|parar|interromper)\b|stop (generating|response|streaming)|parar (de gerar|resposta)|interromper resposta/i;

  /** Título da aba sem o nome do site ("Plano do Statlys - ChatGPT" -> "Plano do Statlys"). */
  function cleanTitle(raw, siteNames) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    for (const name of siteNames) {
      t = t.replace(new RegExp(`\\s*[-|–—·]\\s*${name}\\s*$`, 'i'), '').replace(new RegExp(`^${name}\\s*[-|–—·]\\s*`, 'i'), '');
    }
    if (!t || siteNames.some((n) => t.toLowerCase() === n.toLowerCase()) || /^(new chat|novo chat|nova conversa)$/i.test(t)) return undefined;
    return t.slice(0, 120);
  }

  /** Algum botão visível com rótulo de "parar"? `extra` = seletores específicos do site, conferidos primeiro. */
  function hasStopButton(doc, extra) {
    for (const sel of extra) {
      if (doc.querySelector(sel)) return true;
    }
    for (const b of doc.querySelectorAll('button[aria-label], button[data-testid], button[title]')) {
      const label = b.getAttribute('aria-label') || b.getAttribute('title') || '';
      if (STOP_LABEL.test(label.trim())) return true;
    }
    return false;
  }

  function text(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  const SITES = [
    {
      provider: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      /** /c/<id> e /g/<gpt-ou-projeto>/c/<id>. */
      conversationId(loc) {
        const m = /\/c\/([\w-]{8,})/.exec(loc.pathname);
        return m ? m[1] : undefined;
      },
      title(doc) {
        return cleanTitle(doc.title, ['ChatGPT']);
      },
      project(doc, loc) {
        // Conversa dentro de um Projeto: /g/g-p-<id>-<nome>/c/<id>. O nome também aparece no cabeçalho da página.
        const m = /\/g\/g-p-[\w]+-([\w-]+)\/c\//.exec(loc.pathname);
        if (m) return decodeURIComponent(m[1]).replace(/-/g, ' ');
        return undefined;
      },
      generating(doc) {
        return hasStopButton(doc, ['button[data-testid="stop-button"]', '[data-testid="stop-button"]']);
      },
    },
    {
      provider: 'claude-web',
      name: 'Claude',
      hosts: ['claude.ai'],
      /** /chat/<uuid>. */
      conversationId(loc) {
        const m = /\/chat\/([\w-]{8,})/.exec(loc.pathname);
        return m ? m[1] : undefined;
      },
      title(doc) {
        return cleanTitle(doc.title, ['Claude']);
      },
      project(doc) {
        // Conversa de um Projeto: o cabeçalho tem um link para /project/<id> com o nome do projeto.
        const a = doc.querySelector('header a[href^="/project/"], nav a[href^="/project/"][aria-current], a[href^="/project/"][data-testid]');
        const name = text(a);
        return name && name.length <= 60 ? name : undefined;
      },
      generating(doc) {
        return hasStopButton(doc, ['button[aria-label="Stop response"]', 'button[aria-label="Parar resposta"]', '[data-is-streaming="true"]']);
      },
    },
    {
      provider: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      /** /app/<id> e /gem/<gem>/<id>. */
      conversationId(loc) {
        const m = /\/(?:app|gem\/[\w-]+)\/([\w-]{8,})/.exec(loc.pathname);
        return m ? m[1] : undefined;
      },
      title(doc) {
        return cleanTitle(doc.title, ['Gemini', 'Google Gemini']);
      },
      project(doc, loc) {
        // Conversa com um Gem: /gem/<nome-do-gem>/<id>.
        const m = /\/gem\/([\w-]+)\//.exec(loc.pathname);
        return m ? decodeURIComponent(m[1]).replace(/-/g, ' ') : undefined;
      },
      generating(doc) {
        return hasStopButton(doc, ['button[aria-label*="Stop response"]', 'button[aria-label*="Parar resposta"]', 'button.stop']);
      },
    },
  ];

  /** O site da página (ou undefined fora dos sites conhecidos). */
  function siteFor(loc) {
    const host = String(loc.hostname || '').toLowerCase();
    return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  }

  /** Estado da conversa na página: o que o content.js manda para o background. */
  function readState(loc, doc) {
    const site = siteFor(loc);
    if (!site) return undefined;
    const conversationId = site.conversationId(loc);
    if (!conversationId) return { provider: site.provider };
    const state = { provider: site.provider, conversationId, generating: !!site.generating(doc) };
    const title = site.title(doc);
    if (title) state.title = title;
    const project = site.project(doc, loc);
    if (project) state.project = project.slice(0, 40);
    return state;
  }

  root.HabblaudSites = { SITES, siteFor, readState, cleanTitle, hasStopButton, STOP_LABEL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
