// Equipe fixa: agentes com nome, cargo e sala próprios que ficam SEMPRE no escritório (ociosos quando ninguém está
// conversando com eles). Lida de equipe.json:
//
//   {
//     "salaPadrao": "Muraca Data Consulting",
//     "membros": [
//       {"nome": "Harvey", "cargo": "Vendedor", "sala": "Vendas", "genero": "m", "ia": "claude-web"}
//     ]
//   }
//
// - `sala` (opcional): sala do agente; sem ela, `salaPadrao` (ou "Equipe").
// - `genero` (opcional): 'f' ou 'm', o visual do nome.
// - `ia` (opcional): a IA que costuma fazer o papel dele (o selo na etiqueta enquanto ninguém conversa com ele);
//   padrão 'claude-web'. Quando você abre a conversa dele em outra IA, o selo muda para ela.
//
// Uma conversa de chat cujo TÍTULO começa com o nome do agente seguido de um separador ("Harvey · Vendas",
// "Harvey (Vendedor)", "Harvey - follow-ups", ou só "Harvey") é a conversa daquele agente: em vez de criar uma pessoa
// nova, ela faz o agente da equipe sentar e trabalhar.
import { existsSync, readFileSync } from 'node:fs';
import { isChatProvider, type ChatProvider } from '../../../shared/types';
import { errMsg, log } from '../../log';
import { cleanRoom } from './source';

export interface TeamMember {
  /** Id estável do agente no escritório ("team:harvey"). */
  id: string;
  name: string;
  role: string;
  room: string;
  look: 'f' | 'm';
  provider: ChatProvider;
}

/** Sem acentos e em minúsculas (para comparar nomes). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function slug(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
}

/** Valida o conteúdo do equipe.json. Membros inválidos ou repetidos são ignorados (com aviso). */
export function parseTeam(raw: unknown): TeamMember[] {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaultRoom = (typeof r.salaPadrao === 'string' && cleanRoom(r.salaPadrao)) || 'Equipe';
  const list = Array.isArray(r.membros) ? r.membros : [];
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const m = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = typeof m.nome === 'string' ? m.nome.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    if (!name) {
      log.warn('Equipe: membro sem "nome" ignorado.');
      continue;
    }
    const id = `team:${slug(name)}`;
    if (seen.has(id)) {
      log.warn(`Equipe: "${name}" aparece duas vezes; fica só o primeiro.`);
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name,
      role: (typeof m.cargo === 'string' && m.cargo.trim().slice(0, 40)) || 'Equipe',
      room: (typeof m.sala === 'string' && cleanRoom(m.sala)) || defaultRoom,
      look: m.genero === 'f' ? 'f' : 'm',
      provider: typeof m.ia === 'string' && isChatProvider(m.ia) ? m.ia : 'claude-web',
    });
  }
  return out;
}

/** Lê o primeiro equipe.json que existir. Nenhum = equipe vazia. */
export function loadTeam(files: readonly string[]): { members: TeamMember[]; file?: string } {
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      return { members: parseTeam(JSON.parse(readFileSync(file, 'utf8'))), file };
    } catch (err) {
      log.warn(`Equipe: não consegui ler ${file} (${errMsg(err)}).`);
      return { members: [], file };
    }
  }
  return { members: [] };
}

/** O agente da equipe dono de uma conversa, pelo título ("Harvey · Vendas" -> Harvey). */
export function memberForTitle(members: readonly TeamMember[], title: string | undefined): TeamMember | undefined {
  if (!title) return undefined;
  const t = fold(title);
  return members.find((m) => {
    const n = fold(m.name);
    if (!t.startsWith(n)) return false;
    const rest = t.slice(n.length);
    return rest === '' || /^\s*[·•\-–—|:(]/.test(rest);
  });
}
