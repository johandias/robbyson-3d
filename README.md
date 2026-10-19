# Robbyson 3D

Assistente de voz em tempo real com personagem GLB, animação procedural e OpenAI Realtime API.

## Executar

```bash
python3 server.py
```

Abra [http://localhost:8000](http://localhost:8000) no navegador.

Para usar HTTPS com o microfone local sem avisos de segurança:

```bash
bash scripts/make-cert.sh
python3 server.py
```

Abra [https://localhost:8443](https://localhost:8443).

## Configuração

Também é possível copiar `.env.example` para `.env` e preencher a chave. O `.env` nunca deve ser versionado.

- Modelo e voz são escolhidos antes de iniciar a sessão.
- **Conversar por texto** não solicita microfone: digite no chat e ouça a resposta falada. **Conversar por voz** mantém a entrada pelo microfone. O botão Áudio permite silenciar ou reativar a saída em ambos os modos.
- A chave permanente nunca é enviada ao navegador; o backend entrega apenas um token efêmero.
- O `untitled.glb` possui blendshapes faciais nativos (JawOpen, Mouth_A, Mouth_E, Mouth_I, Mouth_O, Mouth_U, Mouth_Smile, etc.). No carregamento, uma correção localizada `Mouth_Closed` aproxima os lábios sem mover nariz ou queixo. O áudio controla a transição natural entre boca fechada e abertura sincronizada com fala e vogais.
- O controlador corporal em `motion/` calibra o esqueleto Mixamo do GLB e resolve braços e pernas com cinemática inversa. Os cotovelos e braços são calibrados para manter postura natural junto ao corpo, sem abrir lateralmente em excesso.
- As poses incluem palmas abertas, explicação, comparação, ênfase, uma mão apoiada sobre a outra e palmas juntas. As duas poses de contato compartilham uma referência geométrica, mantêm uma separação compatível com a espessura das mãos e desativam oscilações independentes dos punhos.
- Durante fala longa, o personagem alterna gestos em intervalos variáveis, faz pausas curtas e pode dar um passo discreto no lugar. Em espera, usa respiração sutil, pequenos movimentos dos braços e mudanças ocasionais de apoio.
- Em descanso, os braços mantêm uma postura natural vertical ao lado do tronco; as mãos acompanham o deslocamento dos ombros para preservar essa silhueta durante a respiração e a mudança de apoio.
- O estado corporal acompanha os eventos de reprodução da Realtime API e a energia do áudio local. Texto recebido acumula sugestões de intenção, mas o gesto só é escolhido quando há fala audível; `response.done` não encerra prematuramente a animação.
- O botão **Demonstrar movimentos** percorre os gestos e fala sincronizada, sem iniciar conversa ou ativar o microfone.

## Diagnóstico de movimento

Abra [http://localhost:8000/index.html?motion-diagnostics=1](http://localhost:8000/index.html?motion-diagnostics=1) para forçar poses, executar cenários reproduzíveis de fala, espera, escuta e interrupção, alternar entre 30 e 60 FPS e inspecionar contatos, alcance dos braços, joelhos e estabilidade dos pés em diferentes câmeras.

## Testes

```bash
node --test tests/motion.test.js
```

Os testes carregam o GLB usado pela aplicação e verificam transições entre gestos, limites de alcance, separação das mãos, orientação dos joelhos, deriva dos pés, passos, interrupções e comportamento equivalente em 30 e 60 FPS.
