// Fonte das conversas de chat: eventos do POST /api/events viram personagens (uma conversa = uma pessoa fixa).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../../accounts/service';
import { parseEventsBody } from '../../chat/http';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import { ChatSource, DEFAULT_ROOM, parseChatEvent, PRESENCE_TIMEOUT_MS, type ChatEvent } from './source';
import { memberForTitle, parseTeam } from './team';

setQuiet(true);

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

function setup(roomsFile?: string) {
  let clock = Date.now();
  const now = () => clock;
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: tmpdir(), env: {}, now, onChange: () => late.office?.markDirty() });
  const names = new NameStore(null);
  const office = new Office({
    names,
    version: 'teste',
    startedAt: clock,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    now,
  });
  late.office = office;
  const source = new ChatSource({ office, accounts, roomsFile, now });
  source.start();
  cleanups.push(() => source.stop());
  const ev = (e: Partial<ChatEvent> & Pick<ChatEvent, 'type'>) =>
    source.apply(parseChatEvent({ provider: 'chatgpt', conversationId: 'abc123', ...e }));
  return {
    office,
    accounts,
    source,
    ev,
    advance(ms: number) {
      clock += ms;
    },
    snap() {
      office.tick();
      return office.commit().snapshot;
    },
  };
}

describe('parseChatEvent', () => {
  it('valida tipo, provedor e id da conversa', () => {
    expect(() => parseChatEvent({ type: 'x', provider: 'chatgpt', conversationId: 'a' })).toThrow(/type/);
    expect(() => parseChatEvent({ type: 'open', provider: 'bard', conversationId: 'a' })).toThrow(/provider/);
    expect(() => parseChatEvent({ type: 'open', provider: 'chatgpt', conversationId: '../x' })).toThrow(/conversationId/);
    expect(() => parseChatEvent({ type: 'status', provider: 'chatgpt', conversationId: 'a', status: 'busy' })).toThrow(/status/);
  });

  it('limpa a sala e corta textos longos', () => {
    const e = parseChatEvent({ type: 'open', provider: 'gemini', conversationId: 'a', room: '  Sta/tlys  ', title: 'x'.repeat(500) });
    expect(e.room).toBe('Sta-tlys');
    expect(e.title?.length).toBe(120);
  });

  it('aceita um evento ou um lote', () => {
    expect(parseEventsBody({ type: 'open', provider: 'web', conversationId: 'a' })).toHaveLength(1);
    expect(parseEventsBody({ events: [{ type: 'open', provider: 'web', conversationId: 'a' }, { type: 'close', provider: 'web', conversationId: 'a' }] })).toHaveLength(2);
    expect(() => parseEventsBody({ events: [{ type: 'open', provider: 'web', conversationId: 'a' }, { type: 'nope' }] })).toThrow(/evento 1/);
  });
});

describe('ChatSource', () => {
  it('uma conversa entra como pessoa na sala do assunto, com o selo da IA', () => {
    const t = setup();
    t.ev({ type: 'open', room: 'Statlys', title: 'Arquitetura do Statlys' });
    const s = t.snap();
    expect(s.agents).toHaveLength(1);
    const a = s.agents[0];
    expect(a.provider).toBe('chatgpt');
    expect(a.account).toBe('chatgpt');
    expect(a.title).toBe('Arquitetura do Statlys');
    expect(a.status).toBe('idle');
    expect(s.rooms.find((r) => r.id === a.roomId)?.name).toBe('Statlys');
    expect(s.accounts.find((x) => x.id === 'chatgpt')?.name).toBe('ChatGPT');
  });

  it('conversas de IAs diferentes sobre o mesmo assunto dividem a sala', () => {
    const t = setup();
    t.ev({ type: 'open', room: 'Oficina' });
    t.source.apply(parseChatEvent({ type: 'open', provider: 'claude-web', conversationId: 'zzz', room: 'Oficina' }));
    const s = t.snap();
    expect(s.agents).toHaveLength(2);
    expect(new Set(s.agents.map((a) => a.roomId)).size).toBe(1);
    expect(new Set(s.agents.map((a) => a.name)).size).toBe(2);
  });

  it('status e atividades mudam o que o personagem faz', () => {
    const t = setup();
    t.ev({ type: 'activity', room: 'Statlys', activity: { kind: 'prompt', text: 'Recebeu uma pergunta' } });
    expect(t.snap().agents[0].status).toBe('working');
    t.ev({ type: 'activity', activity: { kind: 'web', text: 'Pesquisando na web' } });
    expect(t.snap().agents[0].activity?.text).toBe('Pesquisando na web');
    t.ev({ type: 'status', status: 'idle' });
    const a = t.snap().agents[0];
    expect(a.status).toBe('idle');
    expect(a.activity?.kind).toBe('done');
  });

  it('sem sala no evento, usa a última gravada; sem nenhuma, a padrão', () => {
    const t = setup();
    t.ev({ type: 'open' });
    expect(t.snap().rooms[0].name).toBe(DEFAULT_ROOM);
  });

  it('trocar de sala: sai de uma e chega na outra, com o mesmo nome', () => {
    const t = setup();
    t.ev({ type: 'open', room: 'Statlys' });
    const name = t.snap().agents[0].name;
    t.ev({ type: 'heartbeat', room: 'Oficina' });
    const s = t.snap();
    const live = s.agents.filter((a) => a.status !== 'offline');
    expect(live).toHaveLength(1);
    expect(live[0].name).toBe(name);
    expect(s.rooms.find((r) => r.id === live[0].roomId)?.name).toBe('Oficina');
  });

  it('close tira a conversa; voltar traz a mesma pessoa', () => {
    const t = setup();
    t.ev({ type: 'open', room: 'Statlys' });
    const name = t.snap().agents[0].name;
    t.ev({ type: 'close' });
    expect(t.snap().agents[0].status).toBe('offline');
    t.advance(60_000);
    t.snap();
    t.ev({ type: 'open' });
    const back = t.snap().agents.filter((a) => a.status !== 'offline');
    expect(back).toHaveLength(1);
    expect(back[0].name).toBe(name);
  });

  it('sem sinal de vida por PRESENCE_TIMEOUT_MS, a conversa sai; heartbeat segura', () => {
    const t = setup();
    t.ev({ type: 'open', room: 'Statlys' });
    t.advance(PRESENCE_TIMEOUT_MS - 1_000);
    t.ev({ type: 'heartbeat' });
    t.advance(PRESENCE_TIMEOUT_MS - 1_000);
    t.source.expire();
    expect(t.snap().agents[0].status).not.toBe('offline');
    t.advance(2_000);
    t.source.expire();
    expect(t.snap().agents[0].status).toBe('offline');
    expect(t.source.openCount()).toBe(0);
  });

  it('grava a sala de cada conversa em disco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-rooms-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'chat-rooms.json');
    const t = setup(file);
    t.ev({ type: 'open', room: 'Statlys' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'chatgpt:abc123': 'Statlys' });
    // Outro servidor (reinício): o evento sem sala volta para a gravada.
    const t2 = setup(file);
    t2.ev({ type: 'open' });
    expect(t2.snap().rooms[0].name).toBe('Statlys');
  });
});

describe('equipe fixa', () => {
  const TEAM = parseTeam({
    salaPadrao: 'Muraca Data Consulting',
    membros: [
      { nome: 'Harvey', cargo: 'Vendedor', sala: 'Vendas' },
      { nome: 'Helena', cargo: 'RH', genero: 'f' },
      { nome: 'Helena', cargo: 'repetida' },
      { cargo: 'sem nome' },
    ],
  });

  function setupTeam() {
    let clock = Date.now();
    const now = () => clock;
    const late: { office?: Office } = {};
    const accounts = new AccountsService({ dirs: [], home: tmpdir(), env: {}, now, onChange: () => late.office?.markDirty() });
    const office = new Office({
      names: new NameStore(null),
      version: 'teste',
      startedAt: clock,
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: (id) => accounts.find(id)?.detected.name,
      now,
    });
    late.office = office;
    const source = new ChatSource({ office, accounts, team: TEAM, now });
    source.start();
    cleanups.push(() => source.stop());
    return {
      source,
      ev: (e: Record<string, unknown>) => source.apply(parseChatEvent({ provider: 'claude-web', conversationId: 'conv-harvey-1', ...e })),
      advance: (ms: number) => (clock += ms),
      snap() {
        office.tick();
        return office.commit().snapshot;
      },
      agent(name: string) {
        return this.snap().agents.find((a) => a.name === name);
      },
    };
  }

  it('lê o equipe.json: ignora repetidos e sem nome; sala padrão e gênero', () => {
    expect(TEAM.map((m) => m.name)).toEqual(['Harvey', 'Helena']);
    expect(TEAM[1]).toMatchObject({ id: 'team:helena', room: 'Muraca Data Consulting', look: 'f', provider: 'claude-web' });
  });

  it('reconhece a conversa do agente pelo título', () => {
    expect(memberForTitle(TEAM, 'Harvey · Vendas')?.name).toBe('Harvey');
    expect(memberForTitle(TEAM, 'harvey (Vendedor)')?.name).toBe('Harvey');
    expect(memberForTitle(TEAM, 'Héléna')?.name).toBe('Helena');
    expect(memberForTitle(TEAM, 'Harvey Specter: quem é?')).toBeUndefined();
    expect(memberForTitle(TEAM, 'Plano do Statlys')).toBeUndefined();
  });

  it('todos ficam no escritório desde o início, ociosos, com o nome certo e na sala certa', () => {
    const t = setupTeam();
    const s = t.snap();
    expect(s.agents.map((a) => a.name).sort()).toEqual(['Harvey', 'Helena']);
    expect(s.agents.every((a) => a.status === 'idle')).toBe(true);
    const harvey = s.agents.find((a) => a.name === 'Harvey')!;
    expect(s.rooms.find((r) => r.id === harvey.roomId)?.name).toBe('Vendas');
    expect(harvey.role).toBe('Vendedor');
  });

  it('a conversa do agente faz ele trabalhar, com o selo da IA dela; fechar devolve ao ócio sem ir embora', () => {
    const t = setupTeam();
    t.ev({ type: 'open', title: 'Harvey · Vendas', provider: 'chatgpt' });
    expect(t.snap().agents).toHaveLength(2);
    t.ev({ type: 'activity', provider: 'chatgpt', activity: { kind: 'respond', text: 'Escrevendo a resposta' } });
    expect(t.agent('Harvey')).toMatchObject({ status: 'working', provider: 'chatgpt' });
    t.ev({ type: 'close', provider: 'chatgpt' });
    expect(t.agent('Harvey')).toMatchObject({ status: 'idle', provider: 'claude-web' });
    expect(t.snap().agents).toHaveLength(2);
  });

  it('aba sem sinal: o agente volta ao ócio, mas continua no escritório', () => {
    const t = setupTeam();
    t.ev({ type: 'activity', title: 'Harvey · Vendas', activity: { kind: 'think', text: 'Pensando…' } });
    expect(t.agent('Harvey')?.status).toBe('working');
    t.advance(PRESENCE_TIMEOUT_MS + 1_000);
    t.source.expire();
    expect(t.agent('Harvey')?.status).toBe('idle');
    t.advance(24 * 3600_000);
    t.source.expire();
    expect(t.agent('Harvey')?.status).toBe('idle');
  });

  it('conversa que ganhou o título depois: a pessoa sorteada sai e o agente assume', () => {
    const t = setupTeam();
    t.ev({ type: 'open' });
    expect(t.snap().agents.filter((a) => a.status !== 'offline')).toHaveLength(3);
    t.ev({ type: 'heartbeat', title: 'Harvey · Vendas' });
    expect(t.snap().agents.filter((a) => a.status !== 'offline')).toHaveLength(2);
    t.ev({ type: 'activity', activity: { kind: 'respond', text: 'Escrevendo' } });
    expect(t.agent('Harvey')?.status).toBe('working');
  });
});
