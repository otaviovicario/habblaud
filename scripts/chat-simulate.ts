// Simulador de conversas de chat: manda eventos para o POST /api/events como se a extensão do navegador estivesse
// observando três conversas (Statlys no Claude e no Gemini, Oficina no ChatGPT). Serve para ver o escritório funcionar
// sem a extensão.
//
//   npm run chat:simulate                      -> http://localhost:4747
//   npm run chat:simulate -- --url http://localhost:4848
//   npm run chat:simulate -- --once            -> só abre as conversas, faz uma rodada e fecha
//
// Ctrl+C fecha as conversas (as pessoas vão embora) antes de sair.

type Ev = Record<string, unknown>;

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = (urlArg >= 0 ? args[urlArg + 1] : process.env.HABBLAUD_URL) ?? 'http://localhost:4747';
const once = args.includes('--once');

const CONVERSAS = [
  { provider: 'claude-web', conversationId: 'sim-statlys-claude', room: 'Statlys', title: 'Statlys: leitura de extratos' },
  { provider: 'chatgpt', conversationId: 'sim-oficina-gpt', room: 'Oficina', title: 'Oficina: controle de ordens de serviço' },
  { provider: 'gemini', conversationId: 'sim-statlys-gemini', room: 'Statlys', title: 'Statlys: textos da landing page' },
] as const;

/** O que cada conversa "faz" numa rodada: [atividade, texto, segundos até o próximo passo]. */
const ROTEIRO: Array<[string, string, number]> = [
  ['prompt', 'Recebeu uma pergunta', 2],
  ['think', 'Pensando…', 4],
  ['web', 'Pesquisando na web', 5],
  ['respond', 'Escrevendo a resposta', 6],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(events: Ev[]): Promise<void> {
  const res = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function rodada(c: (typeof CONVERSAS)[number]): Promise<void> {
  for (const [kind, text, secs] of ROTEIRO) {
    await send([{ type: 'activity', ...c, activity: { kind, text } }]);
    await sleep(secs * 1_000);
  }
  await send([{ type: 'status', ...c, status: 'idle' }]);
}

async function fechar(): Promise<void> {
  await send(CONVERSAS.map((c) => ({ type: 'close', provider: c.provider, conversationId: c.conversationId }))).catch(() => undefined);
}

async function main(): Promise<void> {
  console.log(`Simulando ${CONVERSAS.length} conversas em ${base} (Ctrl+C para encerrar)…`);
  await send(CONVERSAS.map((c) => ({ type: 'open', ...c })));
  if (once) {
    await Promise.all(CONVERSAS.map((c) => rodada(c)));
    await fechar();
    console.log('Pronto.');
    return;
  }
  let stop = false;
  process.on('SIGINT', () => {
    stop = true;
    console.log('\nFechando as conversas…');
    void fechar().then(() => process.exit(0));
  });
  // Batimento: mantém as conversas presentes, como a extensão faz enquanto a aba está aberta.
  const beat = setInterval(() => {
    void send(CONVERSAS.map((c) => ({ type: 'heartbeat', provider: c.provider, conversationId: c.conversationId }))).catch(() => undefined);
  }, 30_000);
  // Cada conversa trabalha em ritmo próprio, com pausas (fica "ociosa", tomando café, entre uma pergunta e outra).
  await Promise.all(
    CONVERSAS.map(async (c, i) => {
      await sleep(i * 7_000);
      while (!stop) {
        await rodada(c);
        await sleep(15_000 + Math.random() * 25_000);
      }
    }),
  );
  clearInterval(beat);
}

main().catch((err) => {
  console.error(`Falhou: ${err instanceof Error ? err.message : String(err)}`);
  console.error('O Habblaud está rodando nesse endereço? (use --url para outro)');
  process.exit(1);
});
