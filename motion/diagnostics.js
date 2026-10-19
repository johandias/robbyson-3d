import { GESTURES } from './gestures.js';

export function installDiagnostics({ motion, scene, camera, controls, ui }) {
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Diagnóstico de movimentos');
  panel.className = 'motion-diagnostics';
  panel.innerHTML = `
    <style>
      .motion-diagnostics{position:fixed;right:16px;top:16px;width:300px;z-index:20;padding:18px;background:#0d2030f5;border:1px solid #54e1f5;border-radius:14px;color:#eefaff;font:13px system-ui;box-shadow:0 12px 40px #0008}
      .motion-diagnostics h2{font-size:17px;margin:0 0 8px}.motion-diagnostics p{line-height:1.5;color:#b6cbd8}
      .motion-diagnostics label{display:block;margin-top:12px}.motion-diagnostics select{display:block;width:100%;margin-top:4px;padding:7px;background:#152f42;color:white;border:1px solid #476375;border-radius:6px}
      .motion-diagnostics button{padding:7px;margin:8px 4px 0 0;background:#204356;color:white;border:1px solid #587d92;border-radius:6px;cursor:pointer}
      .motion-diagnostics output{display:block;white-space:pre-wrap;font:12px/1.6 monospace;margin-top:12px}.motion-diagnostics input{margin-right:7px}
      @media(max-width:700px){.motion-diagnostics{position:relative;top:0;right:0;width:auto;margin:12px}}
    </style>
    <h2>Diagnóstico corporal</h2>
    <p>Simulação local, sem API ou microfone. A boca usa um envelope sintético; valide a voz real na tela normal.</p>
    <label>Pose<select id="motionPose"><option value="">Automática</option><option value="rest">Descanso</option>${GESTURES.map((name, i) => `<option value="${name}">${['Explicação direita','Explicação esquerda','Duas mãos','Comparação','Ênfase','Palmas juntas','Mãos sobrepostas'][i]}</option>`).join('')}</select></label>
    <label>Cenário<select id="motionScenario"><option value="short">Conversa curta</option><option value="30">Explicação de 30 segundos</option><option value="120">Explicação de 2 minutos</option><option value="idle">Espera prolongada</option><option value="listening">Escuta prolongada</option><option value="interrupt">Interrupção aos 5 segundos</option></select></label>
    <label>Taxa de atualização<select id="motionFps"><option>60</option><option>30</option></select></label>
    <label><input id="motionBounds" type="checkbox">Mostrar contatos e apoios</label>
    <div><button id="motionPause">Pausar</button><button id="motionAdvance">Avançar 5 s</button><button id="motionRestart">Reiniciar</button><button id="motionStep">Pequeno passo</button></div>
    <div><button data-view="front">Frente</button><button data-view="side">Lado</button><button data-view="three">Perspectiva</button><button data-view="hands">Mãos</button></div>
    <output id="motionMetrics" aria-live="off"></output>
    <p><a href="./index.html" style="color:#54e1f5">Voltar à conversa real</a></p>`;
  document.body.append(panel);
  const get = id => panel.querySelector('#' + id);
  let elapsed = 0, accumulator = 0, paused = false, lastReport = 0;
  const input = { mode: 'idle', speaking: false, audible: false, paused: false, level: 0, delta: 0 };
  ui.connectButton.disabled = true; ui.voiceConnectButton.disabled = true; ui.demoButton.disabled = true;
  const sampleTime = dt => {
    elapsed += dt;
    const scenario = get('motionScenario').value;
    const forced = get('motionPose').value;
    const duration = scenario === 'short' ? 8 : Number(scenario) || Infinity;
    input.mode = scenario === 'listening' || scenario === 'interrupt' && elapsed >= 5 ? 'listening'
      : scenario === 'idle' || elapsed > duration ? 'idle' : 'speaking';
    if (forced && scenario !== 'interrupt') input.mode = forced === 'rest' ? 'idle' : 'speaking';
    input.speaking = input.mode === 'speaking';
    input.audible = input.speaking && elapsed % 4.8 < 4.1;
    input.paused = input.speaking && !input.audible;
    input.level = input.audible ? 0.025 + Math.max(0, Math.sin(elapsed * 13) + 0.25 * Math.sin(elapsed * 21)) * 0.12 : 0;
    input.delta = dt;
    return input;
  };
  const restart = () => {
    elapsed = 0; accumulator = 0; motion.reset(); motion.forceGesture(get('motionPose').value || null);
  };
  get('motionPose').addEventListener('change', restart);
  get('motionScenario').addEventListener('change', () => { get('motionPose').value = ''; restart(); });
  get('motionBounds').addEventListener('change', event => motion.setDebug(scene, event.target.checked));
  get('motionPause').addEventListener('click', () => { paused = !paused; get('motionPause').textContent = paused ? 'Continuar' : 'Pausar'; });
  get('motionAdvance').addEventListener('click', () => {
    const fps = Number(get('motionFps').value);
    for (let i = 0; i < fps * 5; i++) motion.update(1 / fps, sampleTime(1 / fps));
    report(true);
  });
  get('motionRestart').addEventListener('click', restart);
  get('motionStep').addEventListener('click', () => {
    get('motionPose').value = 'explain_right'; motion.forceGesture('explain_right'); motion.requestStep();
  });
  for (const button of panel.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    const view = button.dataset.view;
    const position = { front: [0, 1.72, 6.4], side: [6.4, 1.72, 0], three: [4, 2.1, 5], hands: [0.6, 2.05, 2.9] }[view];
    camera.position.set(...position); controls.target.set(0, view === 'hands' ? 1.8 : 1.42, 0);
    controls.update();
  });
  function report(force = false) {
    if (!force && performance.now() - lastReport < 200) return;
    lastReport = performance.now();
    const d = motion.diagnostics();
    get('motionMetrics').textContent = `Tempo: ${elapsed.toFixed(1)} s · ${get('motionFps').value} FPS\nEstado: ${input.mode}\nGesto: ${d.gesture} / ${d.phase}\nPasso: ${d.step}\nSeparação das palmas: ${(d.separation * 1000).toFixed(2)} mm\nErro do apoio: ${(d.footDrift * 1000).toFixed(4)} mm\nErro de alcance: ${(d.reachError * 1000).toFixed(4)} mm\nJoelhos: ${d.knee.map(x => x.toFixed(1)).join('° / ')}°\nTrocas: ${d.changes} · Passos: ${d.steps}`;
  }
  return {
    sample(dt) {
      accumulator += paused ? 0 : dt;
      const frame = 1 / Number(get('motionFps').value);
      const advance = Math.floor((accumulator + 1e-8) / frame) * frame;
      accumulator -= advance;
      return sampleTime(advance);
    }, report,
  };
}
