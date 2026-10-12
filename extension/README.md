# Habblaud Conversas (extensão do Chrome)

Mostra suas conversas do **ChatGPT**, **Claude** (claude.ai) e **Gemini** como personagens no escritório do Habblaud.

- Abriu uma conversa: uma pessoa chega pelo elevador (sempre a mesma pessoa para a mesma conversa).
- A IA está respondendo: ela senta e digita. Terminou: levanta e vai dar uma volta.
- Fechou a aba: ela vai embora.
- Pelo ícone da extensão você escolhe a **sala** de cada conversa (Statlys, Oficina...). Conversas de um Projeto do
  ChatGPT, de um Projeto do Claude ou de um Gem do Gemini já vão para a sala com o nome dele.

Privacidade: a extensão só envia o id da conversa, o título, a sala e se a IA está respondendo, e só para o Habblaud no
seu próprio computador (`localhost`). Nunca o conteúdo das mensagens.

## Instalar (modo desenvolvedor)

1. Copie esta pasta para o Windows. No Ubuntu (WSL):
   `cp -r ~/habblaud-meu/extension /mnt/c/Users/<seu-usuário>/habblaud-extensao`
2. No Chrome, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta `habblaud-extensao`.
5. Fixe o ícone da extensão na barra (ícone de quebra-cabeça → alfinete).
6. Abra o ícone e confira o endereço do Habblaud (padrão `http://localhost:4848`).

Depois de atualizar os arquivos, volte em `chrome://extensions`, clique em **recarregar** (↻) na extensão e recarregue
as abas de chat que já estavam abertas.

## Como funciona

- `sites.js`: o que cada site tem (id da conversa na URL, título, projeto, botão de "parar resposta").
- `content.js`: roda nas páginas de chat, lê o estado a cada segundo e avisa o background quando muda (e a cada 25 s).
- `translate.js`: transforma o estado da aba em eventos do `POST /api/events` (ver `docs/eventos.md`).
- `background.js`: envia os eventos ao Habblaud e avisa quando a aba fecha.
- `popup.html`/`popup.js`: sala da conversa e endereço do Habblaud.

Os sites mudam o HTML sem aviso. Se uma IA parar de aparecer como "trabalhando", o ajuste fica em `sites.js`
(função `generating` do site).
