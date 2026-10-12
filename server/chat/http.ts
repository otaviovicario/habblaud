// Eventos das conversas de chat (extensão do navegador, simulador ou qualquer integração): POST /api/events.
//
//   POST /api/events   {type, provider, conversationId, ...}            um evento
//                      {events: [{...}, {...}]}                          até MAX_BATCH eventos, aplicados em ordem
//   -> 200 {ok: true, applied: n}   |   400 {error, index?}
//
// Os eventos só observam (nada volta para a conversa), mas só valem vindos do próprio computador: a trava (Host local
// e, fora do Docker, conexão pelo loopback) é conferida em http/app.ts. O protocolo está em
// server/sources/chat/source.ts (ChatEvent) e em docs/eventos.md.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { errMsg, log } from '../log';
import { parseChatEvent, type ChatEvent, type ChatSource } from '../sources/chat/source';

export const MAX_BATCH = 50;

/** Corpo do POST /api/events: um evento ou {events: [...]}. Lança HttpError 400 com o índice do evento inválido. */
export function parseEventsBody(raw: unknown): ChatEvent[] {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
  const list = Array.isArray(r?.events) ? (r.events as unknown[]) : [raw];
  if (!list.length) throw new HttpError(400, 'events vazio');
  if (list.length > MAX_BATCH) throw new HttpError(400, `no máximo ${MAX_BATCH} eventos por vez`);
  return list.map((item, i) => {
    try {
      return parseChatEvent(item);
    } catch (err) {
      throw new HttpError(400, list.length > 1 ? `evento ${i}: ${errMsg(err)}` : errMsg(err));
    }
  });
}

/** Trata POST /api/events (método e Host já conferidos). */
export async function handleChatEvents(req: IncomingMessage, res: ServerResponse, source: ChatSource): Promise<void> {
  const events = parseEventsBody(await readJson(req));
  let applied = 0;
  for (const ev of events) {
    try {
      source.apply(ev);
      applied++;
    } catch (err) {
      log.warnOnce(`chat-event:${errMsg(err)}`, `Eventos das conversas: falha ao aplicar um evento (${errMsg(err)}).`);
    }
  }
  sendJson(res, 200, { ok: true, applied });
}
