# Robbyson 3D

Assistente de voz em tempo real com personagem GLB, animação procedural e OpenAI Realtime API.

## Executar

1. Revogue qualquer chave que tenha sido compartilhada em chats ou código e gere uma nova.
2. Defina a chave somente no servidor:

```powershell
$env:OPENAI_API_KEY="sua-chave-nova"
python server.py
```

3. Abra [http://localhost:8000](http://localhost:8000).

Também é possível copiar `.env.example` para `.env` e preencher a chave. O `.env` está ignorado pelo Git.

## Observações

- Modelo e voz são escolhidos antes de iniciar a sessão.
- **Conversar por texto** não solicita microfone: digite no chat e ouça a resposta falada. **Conversar por voz** mantém a entrada pelo microfone. O botão Áudio permite silenciar ou reativar a saída em ambos os modos.
- A chave permanente nunca é enviada ao navegador; o backend entrega apenas um token efêmero.
- O `untitled.glb` possui blendshapes faciais, mas a expressão original já tem a boca aberta. No carregamento, uma correção localizada `Mouth_Closed` aproxima os lábios sem mover nariz ou queixo. O áudio controla a transição entre boca fechada e abertura moderada; quedas de energia e pausas fecham a boca. Essa aproximação usa volume e espectro, não identifica fonemas.
- Ombros, braços, cotovelos e punhos usam o esqueleto Mixamo do GLB. Os gestos começam com a fala, variam em duração e incluem intervalos de repouso. Tronco e cabeça acompanham discretamente cada gesto, sem balanço contínuo do corpo. As mãos ficam abaixo do peito.
- O botão **Demonstrar movimentos** permite conferir a boca e os gestos durante 8,5 segundos, sem iniciar uma conversa ou ativar o microfone. A boca acompanha rotação e zoom e fica oculta quando o rosto está de costas ou encoberto.
