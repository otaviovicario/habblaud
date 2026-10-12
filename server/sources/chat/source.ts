// Fonte de agentes das conversas de chat (claude.ai, ChatGPT, Gemini ou outra IA): AgentSource 'web'.
//
// Diferente do Claude Code e do Codex, as conversas de chat não gravam nada no computador. Quem conta o que acontece é
// quem as observa (a extensão do navegador, o simulador ou qualquer integração), pelo POST /api/events
// (server/chat/http.ts). Regras:
//
// - Uma CONVERSA vira uma PESSOA fixa: o personagem nasce do par provedor + id da conversa, então a conversa do
//   Statlys é sempre a mesma pessoa (mesmo nome e aparência) toda vez que você volta a ela.
// - A SALA é o assunto (Statlys, Oficina...), não a IA: conversas de IAs diferentes sobre o mesmo assunto dividem a
//   sala. A sala de cada conversa fica gravada em <dataDir>/chat-rooms.json, então um evento sem `room` usa a última.
//   Trocar de sala = a pessoa sai de uma sala e chega na outra (o nome continua o mesmo).
// - PRESENÇA: a conversa entra com qualquer evento e sai com 'close' (aba fechada) ou quando passa
//   PRESENCE_TIMEOUT_MS sem nenhum evento (o observador manda 'heartbeat' enquanto a aba está aberta).
// - STATUS: 'working' (a IA está gerando), 'idle' (esperando você) e 'waiting' (a IA pediu algo explícito a você).
//
// As conversas não têm terminal, permissões nem mensagens pelo escritório: só presença, status e atividade.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { maskSecrets, truncate } from '../../../shared/activity';
import {
  CHAT_PROVIDERS,
  isChatProvider,
  PROVIDER_INFO,
  type Activity,
  type ActivityKind,
  type AgentStatus,
  type ChatProvider,
  type SourceInfo,
} from '../../../shared/types';
import type { AccountsService } from '../../accounts/service';
import { errMsg, log } from '../../log';
import type { Office } from '../../model/office';
import type { AgentSource } from '../source';

/** Sem nenhum evento por este tempo, a conversa sai (aba fechada sem avisar, navegador fechado, computador dormiu). */
export const PRESENCE_TIMEOUT_MS = 120_000;
/** Sala de quem não disse a sua. */
export const DEFAULT_ROOM = 'Conversas';
/** Prefixo do caminho das salas de conversa (o Office usa o caminho como chave e o último pedaço como nome). */
export const CHAT_ROOM_ROOT = '/conversas';

export type ChatEventType = 'open' | 'status' | 'activity' | 'heartbeat' | 'close';
export type ChatStatus = 'working' | 'idle' | 'waiting';

/** Um evento do POST /api/events, já validado (ver parseChatEvent). */
export interface ChatEvent {
  type: ChatEventType;
  provider: ChatProvider;
  /** Id da conversa no site (o da URL). */
  conversationId: string;
  /** Título da conversa. */
  title?: string;
  /** Sala (assunto) da conversa. Ausente = a última gravada, ou DEFAULT_ROOM. */
  room?: string;
  /** Para 'status'. */
  status?: ChatStatus;
  /** Para 'waiting': o que a IA quer de você. */
  waitingFor?: string;
  /** Para 'activity'. */
  activity?: { kind: ActivityKind; text: string; detail?: string };
  /** Epoch ms; ausente = agora. */
  at?: number;
}

const EVENT_TYPES: readonly ChatEventType[] = ['open', 'status', 'activity', 'heartbeat', 'close'];
const STATUSES: readonly ChatStatus[] = ['working', 'idle', 'waiting'];
const KINDS: readonly ActivityKind[] = [
  'prompt', 'think', 'respond', 'read', 'search', 'edit', 'write', 'run', 'test', 'git', 'web', 'browser', 'plan',
  'delegate', 'communicate', 'ask', 'mcp', 'skill', 'wait', 'error', 'compact', 'done', 'other',
];
/** Ícone padrão de cada tipo de atividade das conversas. */
const ICONS: Partial<Record<ActivityKind, string>> = {
  prompt: '📥', think: '💭', respond: '✍️', read: '📖', search: '🔎', edit: '✏️', write: '📝', run: '💻', web: '🌐',
  browser: '🧭', plan: '🗂️', ask: '❓', error: '⚠️', done: '✅', wait: '⏳',
};

/** Nome da sala: sem barras (vira um pedaço do caminho), espaços normalizados, até 40 caracteres. */
export function cleanRoom(raw: string): string | undefined {
  const s = raw.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
  return s && s !== '.' && s !== '..' ? s : undefined;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

/** Valida um evento. Lança Error com a explicação (a rota responde 400). */
export function parseChatEvent(raw: unknown): ChatEvent {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  if (!r) throw new Error('evento deve ser um objeto');
  const type = r.type as ChatEventType;
  if (!EVENT_TYPES.includes(type)) throw new Error(`type deve ser um de: ${EVENT_TYPES.join(', ')}`);
  if (!isChatProvider(r.provider as string)) throw new Error(`provider deve ser um de: ${CHAT_PROVIDERS.join(', ')}`);
  const conversationId = typeof r.conversationId === 'string' ? r.conversationId.trim() : '';
  if (!/^[\w.:-]{1,200}$/.test(conversationId)) throw new Error('conversationId: 1 a 200 caracteres (letras, números, . _ : -)');
  const ev: ChatEvent = { type, provider: r.provider as ChatProvider, conversationId };
  const title = str(r.title, 120);
  if (title) ev.title = maskSecrets(title);
  if (typeof r.room === 'string') {
    const room = cleanRoom(r.room);
    if (room) ev.room = room;
  }
  if (type === 'status') {
    if (!STATUSES.includes(r.status as ChatStatus)) throw new Error(`status deve ser um de: ${STATUSES.join(', ')}`);
    ev.status = r.status as ChatStatus;
    const wf = str(r.waitingFor, 80);
    if (wf) ev.waitingFor = wf;
  }
  if (type === 'activity') {
    const a = r.activity && typeof r.activity === 'object' ? (r.activity as Record<string, unknown>) : undefined;
    const text = str(a?.text, 200);
    if (!a || !text) throw new Error('activity: {kind, text, detail?}');
    const kind = KINDS.includes(a.kind as ActivityKind) ? (a.kind as ActivityKind) : 'other';
    ev.activity = { kind, text: maskSecrets(text) };
    const detail = str(a.detail, 300);
    if (detail) ev.activity.detail = maskSecrets(detail);
  }
  if (typeof r.at === 'number' && Number.isFinite(r.at) && r.at > 0) ev.at = r.at;
  return ev;
}

/** Chave da conversa: provedor + id (o mesmo id em IAs diferentes são conversas diferentes). */
export function conversationKey(provider: ChatProvider, conversationId: string): string {
  return `${provider}:${conversationId}`;
}

/** Id do agente: muda com a sala (trocar de sala = sair de uma e chegar na outra). */
export function chatAgentId(key: string, room: string): string {
  return `chat:${key}@${room.toLowerCase()}`;
}

/** Conta de cada provedor de chat: letra e cor do crachá. */
const ACCOUNT_LOOK: Record<ChatProvider, { short: string; color: string }> = {
  'claude-web': { short: 'C', color: '#f08a3c' },
  chatgpt: { short: 'O', color: '#5cc97b' },
  gemini: { short: 'G', color: '#4aa8e8' },
  web: { short: 'I', color: '#a77bf3' },
};

interface Conversation {
  key: string;
  provider: ChatProvider;
  agentId: string;
  room: string;
  title?: string;
  lastEventAt: number;
}

export interface ChatSourceOptions {
  office: Office;
  accounts: AccountsService;
  /** Onde guardar a sala de cada conversa (<dataDir>/chat-rooms.json); ausente = só na memória. */
  roomsFile?: string;
  now?: () => number;
}

export class ChatSource implements AgentSource {
  readonly provider = 'web' as const;
  private readonly open = new Map<string, Conversation>();
  private rooms: Record<string, string> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly opts: ChatSourceOptions) {
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    this.loadRooms();
    // Uma "conta" por IA de chat (o crachá do personagem, com letra e cor própria).
    this.opts.accounts.setProviderAccounts(
      'web',
      CHAT_PROVIDERS.map((p) => ({
        dir: `chat:${p}`,
        detected: { id: p, configDir: '', name: PROVIDER_INFO[p].name, ...ACCOUNT_LOOK[p] },
      })),
    );
    this.timer = setInterval(() => this.expire(), 5_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sources(): SourceInfo[] {
    return CHAT_PROVIDERS.map((p) => ({
      label: p,
      provider: p,
      path: `chat:${p}`,
      sessions: [...this.open.values()].filter((c) => c.provider === p).length,
      ok: true,
    }));
  }

  /** Conversas não têm arquivo de transcript (nem terminal). */
  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /** Conversas abertas agora (para testes e para o /api/health). */
  openCount(): number {
    return this.open.size;
  }

  /** Aplica um evento já validado. */
  apply(ev: ChatEvent): void {
    const office = this.opts.office;
    const key = conversationKey(ev.provider, ev.conversationId);
    const at = Math.min(ev.at ?? this.now(), this.now());
    let conv = this.open.get(key);

    if (ev.type === 'close') {
      if (conv) this.leave(conv);
      return;
    }

    // Sala: a do evento, a gravada ou a padrão. Mudou de sala = sai de uma e chega na outra.
    const room = ev.room ?? conv?.room ?? this.rooms[key] ?? DEFAULT_ROOM;
    if (ev.room && this.rooms[key] !== ev.room) {
      this.rooms[key] = ev.room;
      this.saveRooms();
    }
    if (conv && conv.room !== room) {
      this.leave(conv);
      conv = undefined;
    }

    if (!conv) {
      conv = { key, provider: ev.provider, agentId: chatAgentId(key, room), room, lastEventAt: at };
      this.open.set(key, conv);
      office.addMain({
        id: conv.agentId,
        provider: ev.provider,
        account: ev.provider,
        // O nome é sorteado e lembrado pelo sessionId: a mesma conversa volta sempre com o mesmo nome.
        sessionId: `chat:${key}`,
        cwd: `${CHAT_ROOM_ROOT}/${room}`,
        role: `Conversa no ${PROVIDER_INFO[ev.provider].name}`,
        startedAt: at,
        status: ev.type === 'status' && ev.status ? ev.status : 'idle',
        waitingFor: ev.waitingFor,
      });
    }
    conv.lastEventAt = Math.max(conv.lastEventAt, at);

    if (ev.title && ev.title !== conv.title) {
      conv.title = ev.title;
      office.applyTranscript(conv.agentId, {
        title: ev.title,
        tasks: [],
        stats: office.get(conv.agentId)?.stats ?? { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
        lastAt: at,
      });
    }

    if (ev.type === 'status' && ev.status) office.setStatus(conv.agentId, ev.status as AgentStatus, ev.waitingFor);

    if (ev.type === 'activity' && ev.activity) {
      const a = ev.activity;
      const activity: Activity = {
        id: `${conv.agentId}#ev:${at}:${++this.seq}`,
        kind: a.kind,
        icon: ICONS[a.kind] ?? '💬',
        text: truncate(a.text, 46),
        at,
      };
      if (a.detail) activity.detail = a.detail;
      office.addActivity(conv.agentId, activity, true);
      // Qualquer atividade de trabalho (pergunta nova, pensando, pesquisando, escrevendo...) = trabalhando, sem precisar
      // de um 'status' separado; 'done' encerra o turno. Pergunta, espera e erro não mudam o status.
      if (a.kind === 'done') office.setStatus(conv.agentId, 'idle');
      else if (a.kind !== 'ask' && a.kind !== 'wait' && a.kind !== 'error') office.setStatus(conv.agentId, 'working');
    }
  }

  /** Conversas sem sinal de vida há PRESENCE_TIMEOUT_MS saem. */
  expire(): void {
    const now = this.now();
    for (const conv of [...this.open.values()]) {
      if (now - conv.lastEventAt > PRESENCE_TIMEOUT_MS) this.leave(conv);
    }
  }

  private leave(conv: Conversation): void {
    this.open.delete(conv.key);
    this.opts.office.closeMain(conv.agentId);
  }

  private loadRooms(): void {
    const file = this.opts.roomsFile;
    if (!file || !existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [k, v] of Object.entries(data)) {
          const room = typeof v === 'string' ? cleanRoom(v) : undefined;
          if (room) this.rooms[k] = room;
        }
      }
    } catch (err) {
      log.warn(`Salas das conversas: não consegui ler ${file} (${errMsg(err)}).`);
    }
  }

  private saveRooms(): void {
    const file = this.opts.roomsFile;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.rooms, null, 2));
      renameSync(tmp, file);
    } catch (err) {
      log.warnOnce(`chat-rooms:${errMsg(err)}`, `Salas das conversas: não consegui gravar ${file} (${errMsg(err)}).`);
    }
  }
}
