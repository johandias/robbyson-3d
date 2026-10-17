# Robbyson 3D

Assistente de voz em tempo real com personagem FBX, animação procedural e OpenAI Realtime API.

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
- A chave permanente nunca é enviada ao navegador; o backend entrega apenas um token efêmero.
- O `T-Pose.fbx` atual não possui blendshapes faciais nem osso de mandíbula. A página usa uma boca HTML/SVG presa ao osso da cabeça por CSS 3D e uma deformação localizada no queixo, sincronizadas com o volume do áudio. É uma aproximação visual, não uma animação fonética por visemas.
- Ombros, braços, cotovelos e punhos usam o esqueleto do FBX, com transições suaves. A postura de repouso mantém as mãos afastadas da calça.
- O botão **Demonstrar movimentos** permite conferir a boca e os gestos durante 8,5 segundos, sem iniciar uma conversa ou ativar o microfone. A boca acompanha rotação e zoom e fica oculta quando o rosto está de costas ou encoberto.
