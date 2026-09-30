# Diza

Amiga no WhatsApp. A sessão é um número só dela. Nesta fase ela conversa com duas pessoas, cada uma com histórico separado.

## Subir

```bash
npm install
cp .env.example .env
npm run dev
```

Preencha no `.env` os dois telefones, com código do país, e pelo menos uma chave: `GEMINI_API_KEY`, `GROQ_API_KEY` ou `OPENROUTER_API_KEY`. Ajuste `DIZA_TIMEZONE` para o fuso de vocês. O horário quieto da iniciativa é 23:00–08:00 nesse fuso.

No primeiro arranque o terminal mostra um QR. Escaneia com o WhatsApp **da Diza** (Aparelhos conectados), não com o seu.

Ela ignora mensagem antiga, grupo e qualquer número que não seja o seu ou o da Diza original. A primeira mensagem de cada conversa tem que partir da pessoa. Depois disso ela pode escrever primeiro, sem precisar de um motivo.

`auth/` guarda a sessão. `data/diza.db` guarda conversas e memórias. Os dois ficam fora do git.

Se o WhatsApp deslogar, apaga a pasta `auth/` e pareia de novo.

Para ver se o processo está no ar: `curl http://127.0.0.1:3080/ping`. A porta muda com `PING_PORT`. A resposta diz há quanto tempo a Diza está ativa.
