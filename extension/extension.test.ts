// Lógica pura da extensão (sites.js e translate.js), com um "documento" mínimo no lugar do DOM.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname);
runInThisContext(readFileSync(join(dir, 'sites.js'), 'utf8'));
runInThisContext(readFileSync(join(dir, 'translate.js'), 'utf8'));
const g = globalThis as unknown as {
  HabblaudSites: { readState: (loc: unknown, doc: unknown) => Record<string, unknown> | undefined; cleanTitle: (t: string, n: string[]) => string | undefined };
  HabblaudTranslate: { translate: (p: unknown, s: unknown, room?: string) => Array<Record<string, unknown>>; closeEvents: (p: unknown) => unknown[] };
};
const { readState, cleanTitle } = g.HabblaudSites;
const { translate, closeEvents } = g.HabblaudTranslate;

interface FakeEl {
  attrs: Record<string, string>;
  text?: string;
  matches: string[];
}

/** Documento falso: `querySelector` acha pelo seletor exato listado em `matches`; `querySelectorAll` devolve todos os botões. */
function doc(title: string, els: FakeEl[] = []) {
  const wrap = (e: FakeEl) => ({ getAttribute: (k: string) => e.attrs[k] ?? null, textContent: e.text ?? '' });
  return {
    title,
    querySelector: (sel: string) => {
      const e = els.find((x) => sel.split(',').some((part) => x.matches.includes(part.trim())));
      return e ? wrap(e) : null;
    },
    querySelectorAll: () => els.map(wrap),
  };
}

const loc = (url: string) => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search };
};

describe('sites.js', () => {
  it('ChatGPT: id pela URL, título sem o nome do site, gerando pelo botão de parar', () => {
    const s = readState(
      loc('https://chatgpt.com/c/6710a1b2-1234-8000-9abc-0123456789ab'),
      doc('Plano do Statlys - ChatGPT', [{ attrs: { 'data-testid': 'stop-button', 'aria-label': 'Stop streaming' }, matches: ['button[data-testid="stop-button"]'] }]),
    );
    expect(s).toEqual({ provider: 'chatgpt', conversationId: '6710a1b2-1234-8000-9abc-0123456789ab', generating: true, title: 'Plano do Statlys' });
  });

  it('ChatGPT: conversa de um Projeto sugere a sala', () => {
    const s = readState(loc('https://chatgpt.com/g/g-p-abc123-oficina-do-irmao/c/6710a1b2-1234'), doc('X - ChatGPT'));
    expect(s?.project).toBe('oficina do irmao');
    expect(s?.generating).toBe(false);
  });

  it('chat novo (sem id) não é conversa ainda', () => {
    expect(readState(loc('https://chatgpt.com/'), doc('ChatGPT'))).toEqual({ provider: 'chatgpt' });
    expect(readState(loc('https://claude.ai/new'), doc('Claude'))).toEqual({ provider: 'claude-web' });
  });

  it('claude.ai: id, projeto pelo link do cabeçalho e rótulo de parar em português', () => {
    const s = readState(
      loc('https://claude.ai/chat/0b5c2d4e-aaaa-bbbb-cccc-123456789abc'),
      doc('Habblaud multi-IA - Claude', [
        { attrs: { href: '/project/123' }, text: ' Habblaud ', matches: ['header a[href^="/project/"]'] },
        { attrs: { 'aria-label': 'Parar resposta' }, matches: [] },
      ]),
    );
    expect(s).toMatchObject({ provider: 'claude-web', conversationId: '0b5c2d4e-aaaa-bbbb-cccc-123456789abc', project: 'Habblaud', generating: true, title: 'Habblaud multi-IA' });
  });

  it('claude.ai: sessões de trabalho em /code/<sessão>', () => {
    expect(readState(loc('https://claude.ai/code/session_01Cz2FhNgxJMSvikhjzbuazb'), doc('Claude'))).toEqual({
      provider: 'claude-web',
      conversationId: 'session_01Cz2FhNgxJMSvikhjzbuazb',
      generating: false,
    });
  });

  it('Gemini: /app/<id> e Gem como sala', () => {
    expect(readState(loc('https://gemini.google.com/app/a1b2c3d4e5f6'), doc('Google Gemini'))).toEqual({ provider: 'gemini', conversationId: 'a1b2c3d4e5f6', generating: false });
    expect(readState(loc('https://gemini.google.com/gem/meu-gem/a1b2c3d4e5f6'), doc('Gemini'))?.project).toBe('meu gem');
  });

  it('Muse: formatos comuns de endereço de conversa', () => {
    expect(readState(loc('https://muse.ai/chat/abc123def'), doc('Plano - Muse'))).toEqual({ provider: 'muse', conversationId: 'abc123def', generating: false, title: 'Plano' });
    expect(readState(loc('https://www.muse.ai/c/xyz7890'), doc('Muse'))?.conversationId).toBe('xyz7890');
    expect(readState(loc('https://muse.ai/?thread=t_123456'), doc('Muse'))?.conversationId).toBe('t_123456');
    expect(readState(loc('https://muse.ai/'), doc('Muse'))).toEqual({ provider: 'muse' });
  });

  it('botões comuns não contam como "parar"', () => {
    const s = readState(loc('https://claude.ai/chat/0b5c2d4e-aaaa'), doc('Claude', [{ attrs: { 'aria-label': 'Copy' }, matches: [] }, { attrs: { 'aria-label': 'Send message' }, matches: [] }]));
    expect(s?.generating).toBe(false);
  });

  it('fora dos sites conhecidos, nada', () => {
    expect(readState(loc('https://example.com/c/12345678'), doc('x'))).toBeUndefined();
  });

  it('cleanTitle tira o nome do site e ignora títulos genéricos', () => {
    expect(cleanTitle('ChatGPT', ['ChatGPT'])).toBeUndefined();
    expect(cleanTitle('New chat', ['ChatGPT'])).toBeUndefined();
    expect(cleanTitle('Receita de bolo | Claude', ['Claude'])).toBe('Receita de bolo');
  });
});

describe('translate.js', () => {
  const A = { provider: 'chatgpt', conversationId: 'aaa11111', title: 'Oficina', generating: false };

  it('primeira vez: open (com a sala escolhida, que vence o projeto)', () => {
    expect(translate(undefined, { ...A, project: 'Proj' }, 'Oficina')).toEqual([
      { type: 'open', provider: 'chatgpt', conversationId: 'aaa11111', title: 'Oficina', room: 'Oficina' },
    ]);
  });

  it('começou a gerar: atividade; parou: idle; nada mudou: heartbeat', () => {
    expect(translate(A, { ...A, generating: true })[0]).toMatchObject({ type: 'activity', activity: { kind: 'respond' } });
    expect(translate({ ...A, generating: true }, A)[0]).toMatchObject({ type: 'status', status: 'idle' });
    expect(translate(A, A)[0]).toMatchObject({ type: 'heartbeat' });
  });

  it('trocou de conversa na mesma aba: fecha a anterior e abre a nova', () => {
    const ev = translate(A, { ...A, conversationId: 'bbb22222' });
    expect(ev.map((e) => e.type)).toEqual(['close', 'open']);
    expect(ev[0].conversationId).toBe('aaa11111');
  });

  it('foi para um chat novo: fecha a anterior', () => {
    expect(translate(A, { provider: 'chatgpt' })).toEqual([{ type: 'close', provider: 'chatgpt', conversationId: 'aaa11111' }]);
  });

  it('aba fechada: close', () => {
    expect(closeEvents(A)).toHaveLength(1);
    expect(closeEvents(undefined)).toHaveLength(0);
  });
});
