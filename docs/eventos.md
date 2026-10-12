# Conversas de chat no escritório (POST /api/events)

Além do Claude Code e do Codex, o escritório mostra **conversas de chat** (claude.ai, ChatGPT, Gemini ou outra IA).
Elas não gravam nada no computador, então quem conta o que acontece é quem as observa: a extensão do navegador, o
simulador (`npm run chat:simulate`) ou qualquer integração que fale HTTP.

## Regras

- **Uma conversa = uma pessoa fixa.** O personagem nasce do par `provider` + `conversationId`: voltar à mesma conversa
  traz a mesma pessoa, com o mesmo nome.
- **A sala é o assunto, não a IA.** Conversas de IAs diferentes com a mesma `room` dividem a sala. A sala de cada
  conversa fica gravada em `~/.habblaud/chat-rooms.json`; eventos sem `room` usam a última.
- **Presença:** a conversa entra com qualquer evento e sai com `close` ou depois de 2 minutos sem nenhum evento (mande
  `heartbeat` enquanto a aba estiver aberta).
- **Selo da IA** na etiqueta do personagem: CLAUDE, GPT, GEMINI ou IA.
- Conversas não têm terminal, permissões nem mensagens pelo escritório.

## Protocolo

`POST http://localhost:4747/api/events` com `Content-Type: application/json`. Só aceito pelo próprio computador.
O corpo é um evento ou `{"events": [...]}` (até 50, aplicados em ordem). Resposta: `{"ok": true, "applied": n}`.

| Campo | Obrigatório | Descrição |
|---|---|---|
| `type` | sim | `open`, `status`, `activity`, `heartbeat` ou `close` |
| `provider` | sim | `claude-web`, `chatgpt`, `gemini` ou `web` |
| `conversationId` | sim | id da conversa (o da URL); letras, números, `.` `_` `:` `-`, até 200 |
| `title` | não | título da conversa |
| `room` | não | sala (assunto), até 40 caracteres |
| `status` | em `status` | `working` (gerando), `idle` (esperando você) ou `waiting` (pediu algo a você) |
| `waitingFor` | não | em `waiting`: o que a IA quer de você |
| `activity` | em `activity` | `{kind, text, detail?}`; `kind` como no Claude Code (`prompt`, `think`, `respond`, `web`, `read`, `write`, `done`...) |
| `at` | não | epoch ms; ausente = agora |

Atividades `prompt`, `think` e `respond` já põem a pessoa trabalhando; `done` (ou `status: idle`) encerra o turno.

```bash
curl -X POST http://localhost:4747/api/events -H 'Content-Type: application/json' -d '{
  "events": [
    {"type": "open", "provider": "chatgpt", "conversationId": "abc123", "room": "Oficina", "title": "Ordens de serviço"},
    {"type": "activity", "provider": "chatgpt", "conversationId": "abc123", "activity": {"kind": "think", "text": "Pensando…"}}
  ]
}'
```

`HABBLAUD_CHAT=0` desliga as conversas de chat.
