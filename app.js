import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  canvas: $("#viewer"), modelStatus: $("#modelStatus"), modelProgress: $("#modelProgress"), facialRig: $("#facialRig"),
  activityLabel: $("#activityLabel"), activityText: $("#activityText"), presenceOrb: $("#presenceOrb"),
  connectionBadge: $("#connectionBadge"), connectButton: $("#connectButton"), voiceConnectButton: $("#voiceConnectButton"), modelSelect: $("#modelSelect"),
  voiceSelect: $("#voiceSelect"), settingsToggle: $("#settingsToggle"), sessionSettings: $("#sessionSettings"),
  conversation: $("#conversation"), messageForm: $("#messageForm"), messageInput: $("#messageInput"), sendButton: $("#sendButton"),
  microphoneButton: $("#microphoneButton"), microphoneState: $("#microphoneState"), speakerButton: $("#speakerButton"),
  speakerState: $("#speakerState"), remoteAudio: $("#remoteAudio"), appNotice: $("#appNotice"),
  resetCamera: $("#resetCamera"), demoButton: $("#demoButton"), toggleBackdrop: $("#toggleBackdrop"),
};

const runtime = {
  model: null, rig: {}, rest: new Map(), aimAxes: new Map(), mouthTargets: [], mouthMode: "none", proceduralMouth: null,
  mode: "idle", previousMode: "idle", modeStartedAt: 0, gestureTime: 0, gestureLevel: 0, demoUntil: 0, demoStartedAt: 0,
  currentKpiKey: "general",
  gesture: {
    elapsed: 0,
    duration: 4.2,
    type: "explain_dual",
    previousType: "explain_dual",
    blend: 1.0,
    leadSide: "both",
    strength: 0.85,
  },
  fingers: {
    leftOpen: 0.1,
    rightOpen: 0.1,
    leftPoint: 0,
    rightPoint: 0,
  },
  posture: {
    weightShift: 0.35,
    targetWeightShift: 0.35,
    shiftTimer: 7.5,
    shiftProgress: 1.0,
    headNod: 0,
    nodTimer: 3.2,
  },
  kinetics: {
    leftWristLag: { x: 0, y: 0, vx: 0, vy: 0 },
    rightWristLag: { x: 0, y: 0, vx: 0, vy: 0 },
    prevForeArmLeft: new THREE.Vector3(),
    prevForeArmRight: new THREE.Vector3(),
    beatImpulse: 0,
    beatPulse: 0,
    speechBreathPhase: 0,
    affirmPhase: 0,
    affirmEnvelope: 0,
    affirmWave: 0,
  },
  idleState: { action: "breathe", timer: 0, duration: 5.0 },
  audioLevel: 0, audioActive: false, lastAudibleAt: 0, responseInProgress: false, responseFinishedAt: 0, userSpeaking: false,
  peer: null, channel: null, localStream: null, audioContext: null, analyser: null, analyserData: null, analyserFrequencyData: null,
  connected: false, connecting: false, connectionMode: null, muted: false, speakerMuted: false, streamingMessage: null,
  mouthOpen: 0, mouthRound: 0, mouthPeak: 0.12, hasClosedMouth: false, modelBaseY: 0,
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x173044, 0.035);

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
const defaultCamera = new THREE.Vector3(0, 1.72, 6.4);
camera.position.copy(defaultCamera);

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2.4;
controls.maxDistance = 8.5;
controls.minPolarAngle = Math.PI * 0.18;
controls.maxPolarAngle = Math.PI * 0.72;
controls.target.set(0, 1.42, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.18));
scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x8094a2, 0.65));
const keyLight = new THREE.DirectionalLight(0xfff4e8, 0.8);
keyLight.position.set(-3.5, 5.5, 5.5);
scene.add(keyLight);

const rimLight = new THREE.SpotLight(0x7ed9eb, 12, 12, Math.PI / 5, 0.7, 1.2);
rimLight.position.set(-4, 4, -2);
rimLight.target.position.set(0, 1.4, 0);
scene.add(rimLight, rimLight.target);

const fillLight = new THREE.PointLight(0xc5baff, 2.4, 8);
fillLight.position.set(3, 1.7, -2.5);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.MeshStandardMaterial({ color: 0x0a1722, roughness: 0.82, metalness: 0.24, transparent: true, opacity: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 0.95, 48),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.25 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = -0.024;
scene.add(ring);

const outerRing = new THREE.Mesh(
  new THREE.RingGeometry(1.5, 1.54, 64),
  new THREE.MeshBasicMaterial({ color: 0x818cf8, side: THREE.DoubleSide, transparent: true, opacity: 0.18 }),
);
outerRing.rotation.x = -Math.PI / 2;
outerRing.position.y = -0.024;
scene.add(outerRing);

const particleCount = 120;
const particlesGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount * 3; i += 3) {
  particlePositions[i] = (Math.random() - 0.5) * 4.5;
  particlePositions[i + 1] = Math.random() * 2.8;
  particlePositions[i + 2] = (Math.random() - 0.5) * 4.5;
}
particlesGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({ color: 0x78dbf0, size: 0.018, transparent: true, opacity: 0.32 }));
scene.add(particles);


// 3D SCENERY HOLOGRAPHIC KPI PANELS (World Space - Behind avatar in scenery)
// ============================================================================
const kpiSceneryBackdrop = new THREE.Group();
kpiSceneryBackdrop.position.set(0, 1.48, -0.92);

const leftCanvas = document.createElement("canvas");
leftCanvas.width = 1024;
leftCanvas.height = 640;
const leftCtx = leftCanvas.getContext("2d");
const leftTexture = new THREE.CanvasTexture(leftCanvas);
leftTexture.colorSpace = THREE.SRGBColorSpace;

const rightCanvas = document.createElement("canvas");
rightCanvas.width = 1024;
rightCanvas.height = 640;
const rightCtx = rightCanvas.getContext("2d");
const rightTexture = new THREE.CanvasTexture(rightCanvas);
rightTexture.colorSpace = THREE.SRGBColorSpace;

const panelGeo = new THREE.PlaneGeometry(1.08, 0.68);
const panelMatLeft = new THREE.MeshBasicMaterial({
  map: leftTexture,
  transparent: true,
  opacity: 0.96,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const leftPanelMesh = new THREE.Mesh(panelGeo, panelMatLeft);
leftPanelMesh.position.set(-1.06, 0, 0);
leftPanelMesh.rotation.y = 0.22;

const panelMatRight = new THREE.MeshBasicMaterial({
  map: rightTexture,
  transparent: true,
  opacity: 0.96,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const rightPanelMesh = new THREE.Mesh(panelGeo, panelMatRight);
rightPanelMesh.position.set(1.06, 0, 0);
rightPanelMesh.rotation.y = -0.22;

// Soft holographic frame backing for aesthetic depth
const frameGeo = new THREE.PlaneGeometry(1.11, 0.71);
const frameMat = new THREE.MeshBasicMaterial({
  color: 0x38bdf8,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const leftFrame = new THREE.Mesh(frameGeo, frameMat);
leftFrame.position.set(-1.06, 0, -0.012);
leftFrame.rotation.y = 0.22;

const rightFrame = new THREE.Mesh(frameGeo, frameMat);
rightFrame.position.set(1.06, 0, -0.012);
rightFrame.rotation.y = -0.22;

// Scenery connecting tech arc
const techArc = new THREE.Mesh(
  new THREE.RingGeometry(1.42, 1.432, 64, 1, Math.PI * 0.18, Math.PI * 0.64),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
);
techArc.position.set(0, 0.04, -0.035);

kpiSceneryBackdrop.add(leftFrame);
kpiSceneryBackdrop.add(rightFrame);
kpiSceneryBackdrop.add(leftPanelMesh);
kpiSceneryBackdrop.add(rightPanelMesh);
kpiSceneryBackdrop.add(techArc);

// Add strictly to the 3D scene (world space scenery), NEVER to avatar bones or model
scene.add(kpiSceneryBackdrop);

// KPI Knowledge Base for dynamic display
const kpiTopics = {
  csat: {
    title: "CSAT — Satisfação do Cliente",
    meta: "≥ 88.0%",
    atual: "82.5%",
    gap: "-5.5 p.p.",
    progress: 0.825,
    targetProgress: 0.88,
    status: "ATENÇÃO",
    statusColor: "#f59e0b",
    summary: "Mede o contentamento geral com o atendimento recebido, refletindo diretamente a percepção da marca e retenção do cliente.",
    difficulties: [
      "• Falta de acolhimento nos primeiros 15s de contato",
      "• Respostas excessivamente técnicas e impessoais sem validação",
      "• Interrupções antes do cliente concluir a exposição da dúvida"
    ],
    coachingTip: "Faça escuta ativa e acolha a dúvida antes de apresentar a solução técnica.",
    keywords: ["Satisfação", "Acolhimento", "Escuta Ativa", "Cortesia", "Empatia", "Resolução"]
  },
  tmr: {
    title: "TMR — Tempo Médio de Resolução",
    meta: "≤ 240 seg (4 min)",
    atual: "278 seg (4m38s)",
    gap: "+38 seg",
    progress: 0.74,
    targetProgress: 0.85,
    status: "OPORTUNIDADE",
    statusColor: "#f59e0b",
    summary: "Otimiza a fluidez operacional sem sacrificar a qualidade, garantindo respostas rápidas, seguras e assertivas.",
    difficulties: [
      "• Navegação lenta entre abas do CRM durante a chamada",
      "• Explicações circulares e repetições desnecessárias",
      "• Silêncios prolongados sem posicionar o cliente sobre o andamento"
    ],
    coachingTip: "Seja claro e conciso: posicione o cliente em 1 frase enquanto consulta o sistema.",
    keywords: ["Tempo de Resolução", "Objetividade", "Agilidade", "CRM", "Fluxo Direto", "Eficiência"]
  },
  fcr: {
    title: "FCR — Resolução no 1º Contato",
    meta: "≥ 75.0%",
    atual: "78.2%",
    gap: "+3.2 p.p.",
    progress: 0.782,
    targetProgress: 0.75,
    status: "DENTRO DA META",
    statusColor: "#10b981",
    summary: "Resolve a necessidade do cliente de imediato, eliminando reincidência de ligações e insatisfação operacional.",
    difficulties: [
      "• Solução parcial da dúvida levando à rechamada em até 24h",
      "• Falta de confirmação se o cliente compreendeu todas as etapas",
      "• Não antecipar a próxima etapa do processo ou prazos reais"
    ],
    coachingTip: "Certifique-se de que a demanda foi 100% resolvida antes de finalizar a chamada.",
    keywords: ["Resolução Total", "Sem Rechamadas", "Confirmação", "Diagnóstico Correto", "Eficácia"]
  },
  aderencia: {
    title: "Aderência à Escala & Pausas",
    meta: "≥ 95.0%",
    atual: "96.4%",
    gap: "+1.4 p.p.",
    progress: 0.964,
    targetProgress: 0.95,
    status: "DENTRO DA META",
    statusColor: "#10b981",
    summary: "Garante o cumprimento rigoroso dos horários de log, pausas regulamentares NR-17 e disponibilidade da operação.",
    difficulties: [
      "• Estouro de minutos na pausa NR-17 por atraso no início do login",
      "• Dificuldade em concluir chamada longa antes do horário da pausa",
      "• Transições demoradas entre pausas e postos de atendimento"
    ],
    coachingTip: "Planeje o fechamento dos atendimentos minutos antes da sua pausa programada.",
    keywords: ["Pontualidade", "Escala", "NR-17", "Gestão de Tempo", "Compromisso", "Disponibilidade"]
  },
  qualidade: {
    title: "Monitoria de Qualidade & Script",
    meta: "≥ 90.0%",
    atual: "87.0%",
    gap: "-3.0 p.p.",
    progress: 0.87,
    targetProgress: 0.90,
    status: "ATENÇÃO",
    statusColor: "#f59e0b",
    summary: "Avalia a conformidade técnica, dicção, argumentação e alinhamento às normas de segurança da informação.",
    difficulties: [
      "• Omissão de cláusulas contratuais e confirmações de segurança",
      "• Uso de linguagem coloquial ou gírias em momentos críticos",
      "• Não realização da sondagem completa da necessidade do cliente"
    ],
    coachingTip: "Use o roteiro como bússola, mantendo fala natural e segura com o cliente.",
    keywords: ["Conformidade", "Sondagem", "Dicção", "Segurança", "Clareza", "Script"]
  },
  empatia: {
    title: "Empatia & Inteligência Emocional",
    meta: "100% Atendimentos",
    atual: "89.0%",
    gap: "-11.0 p.p.",
    progress: 0.89,
    targetProgress: 1.0,
    status: "DESENVOLVIMENTO",
    statusColor: "#38bdf8",
    summary: "Capacidade de reconhecer sentimentos, acolher frustrações com serenidade e gerar conexão humana genuína.",
    difficulties: [
      "• Tom reativo frente a clientes insatisfeitos ou exaltados",
      "• Falta de validação da dor antes de passar o procedimento",
      "• Dificuldade em manter calma e postura em picos de ligação"
    ],
    coachingTip: "Respire e valide a situação: 'Entendo perfeitamente o ocorrido e vou resolver agora'.",
    keywords: ["Acolhimento", "Equilíbrio", "Comunicação Não-Violenta", "Tom de Voz", "Paciência"]
  },
  vendas: {
    title: "Conversão & Cross-Selling",
    meta: "≥ 12.0%",
    atual: "9.8%",
    gap: "-2.2 p.p.",
    progress: 0.816,
    targetProgress: 1.0,
    status: "OPORTUNIDADE",
    statusColor: "#f59e0b",
    summary: "Identificação proativa de oportunidades de agregar valor ao cliente com produtos e serviços pertinentes.",
    difficulties: [
      "• Oferta mecânica sem conexão com a necessidade real do cliente",
      "• Medo de objeção ao apresentar novas vantagens ou planos",
      "• Desistir na primeira negativa do cliente sem sondar o motivo"
    ],
    coachingTip: "Só oferte após resolver a dor principal; conecte o benefício ao perfil do cliente.",
    keywords: ["Sondagem de Valor", "Contorno de Objeções", "Benefício Real", "Persuasão", "Conversão"]
  },
  general: {
    title: "Painel Robbyson — Coaching AEC",
    meta: "Excelência Contínua",
    atual: "Em Acompanhamento",
    gap: "Desenvolvimento Ativo",
    progress: 0.88,
    targetProgress: 0.90,
    status: "ATIVO",
    statusColor: "#38bdf8",
    summary: "Visão integrada de desenvolvimento profissional do atendente, conectando metas de operação à qualidade humana.",
    difficulties: [
      "• Conciliar rapidez de resolução com atendimento empático",
      "• Manter energia, escuta e foco consistentes ao longo da jornada",
      "• Aplicar feedbacks recebidos nos atendimentos imediatamente seguintes"
    ],
    coachingTip: "Foque em um ponto de melhoria por vez e acompanhe sua evolução diária.",
    keywords: ["Produtividade", "Foco no Cliente", "Feedback", "Crescimento", "AeC", "Performance"]
  }
};

function drawKpiRoundRect(ctx, x, y, w, h, r, fillStyle, strokeStyle, lineWidth) {
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle && lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function wrapKpiText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0] || "";
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function renderLeftKpiPanel(topic) {
  const ctx = leftCtx;
  const w = 1024;
  const h = 640;
  ctx.clearRect(0, 0, w, h);

  // Outer container: dark glassmorphism card
  const bgGrad = ctx.createLinearGradient(0, 20, 0, 620);
  bgGrad.addColorStop(0, "rgba(9, 23, 38, 0.94)");
  bgGrad.addColorStop(0.5, "rgba(13, 34, 54, 0.94)");
  bgGrad.addColorStop(1, "rgba(7, 18, 30, 0.96)");
  drawKpiRoundRect(ctx, 20, 20, 984, 600, 28, bgGrad, "rgba(56, 189, 248, 0.40)", 3);

  // Top header tag
  drawKpiRoundRect(ctx, 44, 46, 320, 34, 8, "rgba(56, 189, 248, 0.14)", "rgba(56, 189, 248, 0.35)", 1.5);
  ctx.fillStyle = "#7dd3fc";
  ctx.font = '600 15px "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("● INDICADOR OPERACIONAL AEC", 60, 69);

  // Status Badge
  const statusColor = topic.statusColor || "#38bdf8";
  drawKpiRoundRect(ctx, 724, 46, 256, 34, 8, "rgba(15, 23, 42, 0.8)", statusColor, 1.8);
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(topic.status || "ATIVO", 852, 69);

  // Main Indicator Title
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 31px "Segoe UI", sans-serif';
  ctx.fillText(topic.title, 44, 126);

  // 3 Metric Cards Grid
  const cardY = 154;
  const cardH = 126;
  const cardW = 296;

  // 1. Meta
  drawKpiRoundRect(ctx, 44, cardY, cardW, cardH, 16, "rgba(15, 30, 48, 0.85)", "rgba(56, 189, 248, 0.22)", 1.5);
  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillText("META DEFINIDA", 64, cardY + 34);
  ctx.fillStyle = "#38bdf8";
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.fillText(topic.meta, 64, cardY + 76);
  ctx.fillStyle = "#64748b";
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillText("Parâmetro de referência", 64, cardY + 104);

  // 2. Realizado Atual
  drawKpiRoundRect(ctx, 364, cardY, cardW, cardH, 16, "rgba(15, 30, 48, 0.85)", "rgba(56, 189, 248, 0.22)", 1.5);
  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillText("REALIZADO ATUAL", 384, cardY + 34);
  ctx.fillStyle = statusColor;
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.fillText(topic.atual, 384, cardY + 76);
  ctx.fillStyle = "#64748b";
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillText("Ciclo operacional medido", 384, cardY + 104);

  // 3. Gap / Desvio
  drawKpiRoundRect(ctx, 684, cardY, cardW, cardH, 16, "rgba(15, 30, 48, 0.85)", "rgba(56, 189, 248, 0.22)", 1.5);
  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillText("VARIAÇÃO / GAP", 704, cardY + 34);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.fillText(topic.gap, 704, cardY + 76);
  ctx.fillStyle = "#64748b";
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillText("Distância da meta", 704, cardY + 104);

  // Progress Bar Section
  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 15px "Segoe UI", sans-serif';
  ctx.fillText("PROGRESSO DO INDICADOR", 44, 328);

  ctx.fillStyle = "#38bdf8";
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(`REFERÊNCIA: ${topic.meta}`, 980, 328);

  ctx.textAlign = "left";
  // Track
  drawKpiRoundRect(ctx, 44, 344, 936, 26, 13, "rgba(10, 20, 32, 0.85)", "rgba(56, 189, 248, 0.25)", 1.2);
  // Fill
  const fillW = Math.max(30, 936 * Math.min(Math.max(topic.progress || 0.1, 0.05), 1.0));
  const progGrad = ctx.createLinearGradient(44, 0, 44 + fillW, 0);
  progGrad.addColorStop(0, "#0284c7");
  progGrad.addColorStop(1, statusColor);
  drawKpiRoundRect(ctx, 44, 344, fillW, 26, 13, progGrad, null, 0);

  // Target Marker Line
  const targetX = 44 + 936 * Math.min(Math.max(topic.targetProgress || 0.85, 0.1), 0.98);
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(targetX, 338);
  ctx.lineTo(targetX, 376);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("ALVO", targetX, 392);
  ctx.restore();

  // Operational Context Box
  drawKpiRoundRect(ctx, 44, 416, 936, 176, 16, "rgba(15, 30, 48, 0.65)", "rgba(56, 189, 248, 0.25)", 1.5);
  ctx.fillStyle = "#38bdf8";
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("DIRETRIZ E OBJETIVO OPERACIONAL", 68, 452);

  ctx.fillStyle = "#cbd5e1";
  ctx.font = '17px "Segoe UI", sans-serif';
  const summaryLines = wrapKpiText(ctx, topic.summary || "", 880);
  summaryLines.forEach((line, idx) => {
    ctx.fillText(line, 68, 488 + idx * 28);
  });
}

function renderRightKpiPanel(topic) {
  const ctx = rightCtx;
  const w = 1024;
  const h = 640;
  ctx.clearRect(0, 0, w, h);

  // Outer container: dark glassmorphism card
  const bgGrad = ctx.createLinearGradient(0, 20, 0, 620);
  bgGrad.addColorStop(0, "rgba(9, 23, 38, 0.94)");
  bgGrad.addColorStop(0.5, "rgba(13, 34, 54, 0.94)");
  bgGrad.addColorStop(1, "rgba(7, 18, 30, 0.96)");
  drawKpiRoundRect(ctx, 20, 20, 984, 600, 28, bgGrad, "rgba(56, 189, 248, 0.40)", 3);

  // Top header tag
  drawKpiRoundRect(ctx, 44, 46, 380, 34, 8, "rgba(168, 85, 247, 0.16)", "rgba(168, 85, 247, 0.40)", 1.5);
  ctx.fillStyle = "#c084fc";
  ctx.font = '600 15px "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("● DIAGNÓSTICO & DIRETRIZES DE COACHING", 60, 69);

  // Real-time Badge
  drawKpiRoundRect(ctx, 774, 46, 206, 34, 8, "rgba(52, 211, 153, 0.14)", "#34d399", 1.8);
  ctx.fillStyle = "#34d399";
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("TEMPO REAL", 877, 69);

  // Section 1: Pontos de Dificuldade
  drawKpiRoundRect(ctx, 44, 100, 936, 184, 16, "rgba(30, 27, 45, 0.85)", "rgba(245, 158, 11, 0.35)", 1.5);
  ctx.fillStyle = "#fbbf24";
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("⚠ PONTOS DE DIFICULDADE NO ATENDIMENTO (ATENÇÃO NA OPERAÇÃO)", 68, 134);

  ctx.fillStyle = "#fde68a";
  ctx.font = '16px "Segoe UI", sans-serif';
  const difficulties = topic.difficulties || [];
  difficulties.slice(0, 3).forEach((item, idx) => {
    ctx.fillText(item, 68, 172 + idx * 34);
  });

  // Section 2: Dica Prática do Robbyson
  drawKpiRoundRect(ctx, 44, 302, 936, 134, 16, "rgba(6, 78, 59, 0.40)", "rgba(16, 185, 129, 0.50)", 1.5);
  ctx.fillStyle = "#34d399";
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.fillText("✦ RECOMENDAÇÃO PRÁTICA DO COACH ROBBYSON", 68, 336);

  ctx.fillStyle = "#ecfdf5";
  ctx.font = 'bold 18px "Segoe UI", sans-serif';
  const tipLines = wrapKpiText(ctx, topic.coachingTip || "", 880);
  tipLines.slice(0, 2).forEach((line, idx) => {
    ctx.fillText(line, 68, 372 + idx * 28);
  });

  // Section 3: Palavras-chave & Conceitos
  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 15px "Segoe UI", sans-serif';
  ctx.fillText("PALAVRAS-CHAVE & FOCO DO DIÁLOGO", 44, 474);

  let kwX = 44;
  let kwY = 496;
  const keywords = topic.keywords || [];
  ctx.font = '600 15px "Segoe UI", sans-serif';

  keywords.forEach((kw) => {
    const textW = ctx.measureText(kw).width;
    const pillW = textW + 32;
    if (kwX + pillW > 980) {
      kwX = 44;
      kwY += 46;
    }
    drawKpiRoundRect(ctx, kwX, kwY, pillW, 36, 10, "rgba(56, 189, 248, 0.16)", "rgba(56, 189, 248, 0.42)", 1.2);
    ctx.fillStyle = "#e0f2fe";
    ctx.fillText(kw, kwX + 16, kwY + 23);
    kwX += pillW + 14;
  });
}

function updateKpiBackdrop(topicKey) {
  const topic = kpiTopics[topicKey] || kpiTopics.general;
  runtime.currentKpiKey = topicKey;
  renderLeftKpiPanel(topic);
  renderRightKpiPanel(topic);
  leftTexture.needsUpdate = true;
  rightTexture.needsUpdate = true;
}

function detectTopicFromText(text) {
  if (!text) return null;
  if (/\b(csat|satisfa|nota\s*do\s*cliente|avalia[cç][aã]o)\b/i.test(text)) return "csat";
  if (/\b(tmr|tma|tempo\s*m[eé]dio|segundos|minutos|demora|dura[cç][aã]o)\b/i.test(text)) return "tmr";
  if (/\b(fcr|primeiro\s*contato|resolu[cç][aã]o\s*no\s*primeiro|rechamada)\b/i.test(text)) return "fcr";
  if (/\b(ader[eê]ncia|escala|pausa|pausas|hor[aá]rio|pontualidade|nr-?17)\b/i.test(text)) return "aderencia";
  if (/\b(qualidade|monitoria|script|roteiro|nota\s*de\s*qualidade|conformidade)\b/i.test(text)) return "qualidade";
  if (/\b(empati|acolh|emocional|nervoso|irritad|acalmar|tom\s*de\s*voz|humano|calma|paci[eê]ncia)\b/i.test(text)) return "empatia";
  if (/\b(venda|vendas|convers[aã]o|cross-?sell|oferta|upgrade)\b/i.test(text)) return "vendas";
  if (/\b(meta|metas|indicador|indicadores|kpi|kpis|desempenho|resultado|atingir|atingimento)\b/i.test(text)) {
    return runtime.currentKpiKey === "general" ? "csat" : runtime.currentKpiKey;
  }
  return null;
}

function animateKpiBackdrop(time) {
  if (!kpiSceneryBackdrop.visible) return;
  // Gentle floating levitation in the scenery background
  kpiSceneryBackdrop.position.y = 1.48 + Math.sin(time * 1.25) * 0.014;
  leftPanelMesh.rotation.y = 0.22 + Math.sin(time * 0.85) * 0.008;
  rightPanelMesh.rotation.y = -0.22 - Math.sin(time * 0.85) * 0.008;
}


const clock = new THREE.Clock();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpVec = new THREE.Vector3();
const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpVecC = new THREE.Vector3();
const tmpVecD = new THREE.Vector3();
const aimParentQuaternion = new THREE.Quaternion();
const aimDeltaQuaternion = new THREE.Quaternion();
const aimTargetQuaternion = new THREE.Quaternion();
const aimDirection = new THREE.Vector3();

const armPose = {
  leftUpper: new THREE.Vector3(), leftLower: new THREE.Vector3(),
  rightUpper: new THREE.Vector3(), rightLower: new THREE.Vector3(),
};
const speakingPose = {
  leftUpper: new THREE.Vector3(), leftLower: new THREE.Vector3(),
  rightUpper: new THREE.Vector3(), rightLower: new THREE.Vector3(),
  leftTwist: 0, rightTwist: 0,
};
const legPose = {
  leftUpper: new THREE.Vector3(), leftLower: new THREE.Vector3(),
  rightUpper: new THREE.Vector3(), rightLower: new THREE.Vector3(),
};

const armDirections = {
  // 1. Repouso relaxado natural em pé (braços soltos ao lado do corpo com distância segura das coxas/calça):
  idleLeftUpper: new THREE.Vector3(0.26, -0.960, 0.08).normalize(),
  idleLeftLower: new THREE.Vector3(0.19, -0.978, 0.09).normalize(),
  idleRightUpper: new THREE.Vector3(-0.26, -0.960, 0.08).normalize(),
  idleRightLower: new THREE.Vector3(-0.19, -0.978, 0.09).normalize(),

  // 2. Apresentação aberta com ambas as mãos (palmas abertas para cima, cotovelos flexionados ~90° à frente da cintura/peito):
  dualLeftUpper: new THREE.Vector3(0.26, -0.72, 0.64).normalize(),
  dualLeftLower: new THREE.Vector3(0.20, 0.18, 0.96).normalize(),
  dualRightUpper: new THREE.Vector3(-0.26, -0.72, 0.64).normalize(),
  dualRightLower: new THREE.Vector3(-0.20, 0.18, 0.96).normalize(),

  // 3. Explicação com Mão Direita líder (mão direita explica à frente, mão esquerda apoia na cintura):
  rightLeadUpper: new THREE.Vector3(-0.25, -0.66, 0.70).normalize(),
  rightLeadLower: new THREE.Vector3(-0.14, 0.24, 0.96).normalize(),
  leftSupportUpper: new THREE.Vector3(0.20, -0.86, 0.44).normalize(),
  leftSupportLower: new THREE.Vector3(-0.08, 0.08, 0.99).normalize(),

  // 4. Explicação com Mão Esquerda líder (mão esquerda explica à frente, mão direita apoia na cintura):
  leftLeadUpper: new THREE.Vector3(0.25, -0.66, 0.70).normalize(),
  leftLeadLower: new THREE.Vector3(0.14, 0.24, 0.96).normalize(),
  rightSupportUpper: new THREE.Vector3(-0.20, -0.86, 0.44).normalize(),
  rightSupportLower: new THREE.Vector3(0.08, 0.08, 0.99).normalize(),

  // 5. Ênfase / Ponto Importante (mão dominante se aproxima do centro do peito com palma aberta afirmativa):
  emphasisRightUpper: new THREE.Vector3(-0.20, -0.58, 0.78).normalize(),
  emphasisRightLower: new THREE.Vector3(0.04, 0.28, 0.96).normalize(),
  emphasisLeftUpper: new THREE.Vector3(0.20, -0.58, 0.78).normalize(),
  emphasisLeftLower: new THREE.Vector3(-0.04, 0.28, 0.96).normalize(),

  // 6. Comparação ("De um lado... de outro" - mãos em alturas e posições assimétricas):
  compareLeftUpper: new THREE.Vector3(0.28, -0.62, 0.73).normalize(),
  compareLeftLower: new THREE.Vector3(0.22, 0.32, 0.92).normalize(),
  compareRightUpper: new THREE.Vector3(-0.24, -0.76, 0.60).normalize(),
  compareRightLower: new THREE.Vector3(-0.18, 0.06, 0.98).normalize(),

  // 7. Escuta atenta (braços relaxados em postura acolhedora):
  listenLeftUpper: new THREE.Vector3(0.18, -0.96, 0.16).normalize(),
  listenLeftLower: new THREE.Vector3(0.06, -0.92, 0.38).normalize(),
  listenRightUpper: new THREE.Vector3(-0.18, -0.96, 0.16).normalize(),
  listenRightLower: new THREE.Vector3(-0.06, -0.92, 0.38).normalize(),

  // 8. Reflexão / Pensativo (postura atenta, acolhedora e elegante à frente da cintura, sem levar punho ao queixo):
  thinkRightUpper: new THREE.Vector3(-0.20, -0.92, 0.28).normalize(),
  thinkRightLower: new THREE.Vector3(-0.08, -0.84, 0.52).normalize(),
  thinkLeftUpper: new THREE.Vector3(0.20, -0.92, 0.28).normalize(),
  thinkLeftLower: new THREE.Vector3(0.08, -0.84, 0.52).normalize(),

  // 9. Saudação inicial amigável (onda calorosa com a mão direita):
  waveRightUpper: new THREE.Vector3(-0.30, -0.38, 0.87).normalize(),
  waveRightLower: new THREE.Vector3(0.06, 0.94, 0.33).normalize(),

  // 10. Apresentação Ampla (cotovelos mais longe do corpo / abertura ampla explicativa):
  wideLeftUpper: new THREE.Vector3(0.36, -0.62, 0.70).normalize(),
  wideLeftLower: new THREE.Vector3(0.14, 0.22, 0.96).normalize(),
  wideRightUpper: new THREE.Vector3(-0.36, -0.62, 0.70).normalize(),
  wideRightLower: new THREE.Vector3(-0.14, 0.22, 0.96).normalize(),

  // 11. Mãos Próximas / Posição de Foco Didático e Diálogo (cotovelos perto do corpo, mãos à frente do peito com palmas voltadas uma para a outra, separadas sem se cruzarem):
  prayerLeftUpper: new THREE.Vector3(0.12, -0.82, 0.56).normalize(),
  prayerLeftLower: new THREE.Vector3(-0.36, 0.42, 0.83).normalize(),
  prayerRightUpper: new THREE.Vector3(-0.12, -0.82, 0.56).normalize(),
  prayerRightLower: new THREE.Vector3(0.36, 0.42, 0.83).normalize(),

  // 12. Gesto de Meta e Atingimento de Indicadores (mão esquerda horizontal com palma para cima, mão direita vertical tocando a palma com dedão para cima):
  targetGoalLeftUpper: new THREE.Vector3(0.18, -0.74, 0.64).normalize(),
  targetGoalLeftLower: new THREE.Vector3(-0.36, 0.22, 0.90).normalize(),
  targetGoalRightUpper: new THREE.Vector3(-0.16, -0.72, 0.67).normalize(),
  targetGoalRightLower: new THREE.Vector3(0.18, 0.34, 0.92).normalize(),
};

const legDirections = {
  // Postura neutra em pé:
  leftThighNeutral: new THREE.Vector3(0.09, -0.993, -0.07).normalize(),
  leftShinNeutral: new THREE.Vector3(0.09, -0.992, -0.07).normalize(),
  rightThighNeutral: new THREE.Vector3(-0.09, -0.993, -0.07).normalize(),
  rightShinNeutral: new THREE.Vector3(-0.09, -0.992, -0.07).normalize(),

  // Contrapposto - Peso na perna Esquerda (perna esquerda firme, joelho direito com microflexão sagital estável):
  leftThighFirm: new THREE.Vector3(0.05, -0.997, -0.05).normalize(),
  leftShinFirm: new THREE.Vector3(0.05, -0.997, -0.05).normalize(),
  rightThighRelaxed: new THREE.Vector3(-0.13, -0.978, 0.16).normalize(),
  rightShinRelaxed: new THREE.Vector3(-0.09, -0.965, -0.24).normalize(),

  // Contrapposto - Peso na perna Direita (perna direita firme, joelho esquerdo com microflexão sagital estável):
  rightThighFirm: new THREE.Vector3(-0.05, -0.997, -0.05).normalize(),
  rightShinFirm: new THREE.Vector3(-0.05, -0.997, -0.05).normalize(),
  leftThighRelaxed: new THREE.Vector3(0.13, -0.978, 0.16).normalize(),
  leftShinRelaxed: new THREE.Vector3(0.09, -0.965, -0.24).normalize(),
};

const boneAliases = {
  hips: ["hips", "pelvis"],
  spine: ["spine"],
  spine1: ["spine1"],
  spine2: ["spine2", "chest"],
  neck: ["neck"],
  head: ["head"],
  jaw: ["jaw", "lowerjaw", "chin", "queixo", "mandible", "mandibula", "maxilar", "maxilarinferior"],
  leftShoulder: ["leftshoulder"],
  leftArm: ["leftarm", "leftupperarm"],
  leftForeArm: ["leftforearm", "leftlowerarm"],
  leftHand: ["lefthand"],
  rightShoulder: ["rightshoulder"],
  rightArm: ["rightarm", "rightupperarm"],
  rightForeArm: ["rightforearm", "rightlowerarm"],
  rightHand: ["righthand"],

  // Dedos das mãos para gesticulação humana natural:
  leftThumb1: ["lefthandthumb1"],
  leftThumb2: ["lefthandthumb2"],
  leftThumb3: ["lefthandthumb3"],
  leftIndex1: ["lefthandindex1"],
  leftIndex2: ["lefthandindex2"],
  leftIndex3: ["lefthandindex3"],
  rightThumb1: ["righthandthumb1"],
  rightThumb2: ["righthandthumb2"],
  rightThumb3: ["righthandthumb3"],
  rightIndex1: ["righthandindex1"],
  rightIndex2: ["righthandindex2"],
  rightIndex3: ["righthandindex3"],

  leftUpLeg: ["leftupleg", "leftupperleg", "leftthigh"],
  leftLeg: ["leftleg", "leftlowerleg", "leftcalf", "leftknee"],
  leftFoot: ["leftfoot", "leftankle"],
  leftToeBase: ["lefttoebase", "lefttoe"],
  rightUpLeg: ["rightupleg", "rightupperleg", "rightthigh"],
  rightLeg: ["rightleg", "rightlowerleg", "rightcalf", "rightknee"],
  rightFoot: ["rightfoot", "rightankle"],
  rightToeBase: ["righttoebase", "righttoe"],
};

function normalizeName(name) {
  return name.toLowerCase().replace(/mixamorig/g, "").replace(/[^a-z0-9]/g, "");
}

function mapRig(model) {
  const bones = [];
  model.traverse((node) => { if (node.isBone) bones.push(node); });
  for (const [part, aliases] of Object.entries(boneAliases)) {
    const bone = bones.find((candidate) => aliases.includes(normalizeName(candidate.name)))
      || bones.find((candidate) => aliases.some((alias) => normalizeName(candidate.name).endsWith(alias)));
    if (bone) {
      runtime.rig[part] = bone;
      runtime.rest.set(bone.uuid, { quaternion: bone.quaternion.clone(), position: bone.position.clone() });
    }
  }

  runtime.mouthTargets = [];
  runtime.hasClosedMouth = false;
  const mouthPattern = /^(jaw|mouth|viseme|phoneme|lip)/i;
  model.traverse((node) => {
    if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
    if (node.morphTargetDictionary.Mouth_Closed !== undefined) runtime.hasClosedMouth = true;
    for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
      if (mouthPattern.test(name)) runtime.mouthTargets.push({ mesh: node, index, name: name.toLowerCase() });
    }
  });

  if (runtime.mouthTargets.length) {
    runtime.mouthMode = "blendshapes";
    ui.facialRig.innerHTML = '<i class="dot green"></i>Sincronia facial por blendshapes';
  } else if (runtime.rig.jaw) {
    runtime.mouthMode = "jaw";
    ui.facialRig.innerHTML = '<i class="dot green"></i>Sincronia pelo maxilar';
  } else if (runtime.rig.head) {
    runtime.mouthMode = "procedural";
    ui.facialRig.innerHTML = '<i class="dot green"></i>Expressão facial sincronizada';
  } else {
    runtime.mouthMode = "none";
    ui.facialRig.innerHTML = '<i class="dot amber"></i>Osso da cabeça não encontrado';
  }
}

function addClosedMouthTarget(mesh) {
  // This avatar neutral mesh is an open smile; its MBP target does not close
  // the lip gap. Compress only the mouth patch, preserving the nose and chin.
  const geometry = mesh.geometry;
  if (mesh.morphTargetDictionary?.Mouth_MBP === undefined || mesh.morphTargetDictionary.Mouth_Closed !== undefined) return;
  const position = geometry.getAttribute("position");
  const baseBounds = new THREE.Box3().setFromBufferAttribute(position);
  const unit = (baseBounds.max.y - baseBounds.min.y) / 19.051485;
  const closedGeometry = geometry.clone();
  closedGeometry.morphAttributes = {};
  const closed = position.clone();
  closedGeometry.setAttribute("position", closed);
  for (let index = 0; index < position.count; index += 1) {
    const x = Math.abs(position.getX(index) / unit);
    const y = position.getY(index) / unit;
    const z = position.getZ(index) / unit;
    const influence = (1 - THREE.MathUtils.smoothstep(x, 0.57, 0.78))
      * THREE.MathUtils.smoothstep(z, 0.7, 1)
      * THREE.MathUtils.smoothstep(y, 14.65, 14.88)
      * (1 - THREE.MathUtils.smoothstep(y, 15.2, 15.32));
    const lipLine = 15.12 + 0.1 * (Math.min(x, 0.65) / 0.6) ** 2;
    closed.setY(index, position.getY(index) + (lipLine - y) * unit * 0.975 * influence);
  }
  closedGeometry.computeVertexNormals();
  const deltaPosition = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const deltaNormal = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const normals = geometry.getAttribute("normal");
  const closedNormals = closedGeometry.getAttribute("normal");
  for (let index = 0; index < position.count; index += 1) {
    const changed = Math.abs(closed.getY(index) - position.getY(index)) > 0.000001;
    for (let component = 0; component < 3; component += 1) {
      deltaPosition.setComponent(index, component, closed.getComponent(index, component) - (geometry.morphTargetsRelative ? position.getComponent(index, component) : 0));
      const normal = changed ? closedNormals.getComponent(index, component) : normals.getComponent(index, component);
      deltaNormal.setComponent(index, component, normal - (geometry.morphTargetsRelative ? normals.getComponent(index, component) : 0));
    }
  }
  deltaPosition.name = "Mouth_Closed";
  deltaNormal.name = "Mouth_Closed";
  geometry.morphAttributes.position.push(deltaPosition);
  geometry.morphAttributes.normal.push(deltaNormal);
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences[mesh.morphTargetDictionary.Mouth_Closed] = 1;
  runtime.hasClosedMouth = true;
  closedGeometry.dispose();
}

function setupProceduralMouth() {
  if (runtime.mouthMode !== "procedural" || !runtime.rig.head) return;
  runtime.proceduralMouth = null;
}

function showModelError(message, error) {
  if (error) console.error("Falha ao carregar GLB:", error);
  ui.modelStatus.querySelector("strong").textContent = "Modelo indisponível";
  ui.modelProgress.textContent = message;
  ui.modelStatus.querySelector(".loader").style.display = "none";
}

function loadModel() {
  const loader = new GLTFLoader();
  loader.load(
    "./untitled.glb",
    (gltf) => {
      try {
        const model = gltf.scene;
        if (!model) {
          showModelError("O GLB não contém uma cena 3D válida.");
          return;
        }
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) {
          showModelError("O GLB não possui dimensões válidas.");
          return;
        }
        const scale = 3.05 / Math.max(size.y, 0.01);
        model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        model.scale.setScalar(scale);
        model.traverse((node) => {
          if (!node.isMesh) return;
          addClosedMouthTarget(node);
          node.castShadow = true;
          node.receiveShadow = false;
          if (Array.isArray(node.material)) node.material.forEach(prepareMaterial);
          else prepareMaterial(node.material);
        });
        runtime.model = model;
        runtime.modelBaseY = model.position.y;
        mapRig(model);
        setupProceduralMouth();
        scene.add(model);
        model.updateMatrixWorld(true);
        renderer.render(scene, camera);
        window.__robbysonModel = model;
        window.__robbysonRig = runtime.rig;
        ui.modelStatus.classList.add("is-hidden");
        updateKpiBackdrop(runtime.currentKpiKey || "general");
      } catch (error) {
        showModelError("Não foi possível preparar o avatar 3D.", error);
      }
    },
    (progress) => {
      if (!progress.total) return;
      const percent = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
      ui.modelProgress.textContent = `Carregando modelo 3D… ${percent}%`;
    },
    (error) => {
      showModelError("Confirme se untitled.glb está na pasta do projeto.", error);
    },
  );
}

function prepareMaterial(material) {
  if (!material) return;
  material.metalness = 0;
  material.roughness = 0.88;
  if ("specularIntensity" in material) material.specularIntensity = 0.3;
  if ("specularColor" in material) material.specularColor.set(0xffffff);
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    material.map.minFilter = THREE.LinearMipmapLinearFilter;
    material.map.magFilter = THREE.LinearFilter;
    material.map.needsUpdate = true;
  }
  material.needsUpdate = true;
}

function translateBone(part, x = 0, y = 0, z = 0, speed = 5, delta = 1 / 60) {
  const bone = runtime.rig[part];
  if (!bone) return;
  const rest = runtime.rest.get(bone.uuid);
  if (!rest) return;
  tmpVec.set(rest.position.x + x, rest.position.y + y, rest.position.z + z);
  bone.position.lerp(tmpVec, 1 - Math.exp(-speed * delta));
}

function applyBone(part, x = 0, y = 0, z = 0, speed = 7, delta = 1 / 60) {
  const bone = runtime.rig[part];
  if (!bone) return;
  const rest = runtime.rest.get(bone.uuid);
  if (!rest) return;
  tmpEuler.set(x, y, z, "XYZ");
  tmpQuat.setFromEuler(tmpEuler).multiply(rest.quaternion);
  bone.quaternion.slerp(tmpQuat, 1 - Math.exp(-speed * delta));
}

function aimBone(part, childPart, worldDirection, speed = 7, delta = 1 / 60, twist = 0) {
  const bone = runtime.rig[part];
  const child = runtime.rig[childPart];
  if (!bone || !child || !bone.parent) return;
  const rest = runtime.rest.get(bone.uuid);
  let axis = runtime.aimAxes.get(bone.uuid);
  if (!axis) {
    const localAxis = child.position.clone().normalize();
    axis = { local: localAxis, restParent: localAxis.clone().applyQuaternion(rest.quaternion).normalize() };
    runtime.aimAxes.set(bone.uuid, axis);
  }
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(aimParentQuaternion).invert();
  aimDirection.copy(worldDirection).applyQuaternion(aimParentQuaternion).normalize();
  aimDeltaQuaternion.setFromUnitVectors(axis.restParent, aimDirection);
  aimTargetQuaternion.copy(aimDeltaQuaternion).multiply(rest.quaternion);
  if (twist !== 0) {
    tmpQuat.setFromAxisAngle(axis.local, twist);
    aimTargetQuaternion.multiply(tmpQuat);
  }
  bone.quaternion.slerp(aimTargetQuaternion, 1 - Math.exp(-speed * delta));
}

function applyFingers(side, openness = 0, point = 0, speed = 6, delta = 1 / 60, thumbUp = 0, dynamicSplay = 0) {
  const isLeft = side === "left";
  const open = THREE.MathUtils.clamp(openness + dynamicSplay, 0, 1);
  const p = THREE.MathUtils.clamp(point, 0, 1);
  const up = THREE.MathUtils.clamp(thumbUp, 0, 1);

  // Cascata anatômica de flexão:
  // Index1 (MCP) flexiona/abre suavemente acompanhando a intenção,
  // Index2 (PIP) e Index3 (DIP) modelam a curvatura acolhedora e natural da palma aberta:
  const idx1 = -0.10 * open + 0.06 * (1 - open) - 0.06 * p;
  const idx2 = -0.28 * open + 0.14 * (1 - open) - 0.10 * p;
  const idx3 = -0.22 * open + 0.10 * (1 - open) - 0.08 * p;

  applyBone(side + "Index1", idx1, 0, 0, speed, delta);
  applyBone(side + "Index2", idx2, 0, 0, speed, delta);
  applyBone(side + "Index3", idx3, 0, 0, speed, delta);

  // Polegar: rotação lateral (Z) e extensão vertical (X) com anatomia expressiva:
  // Em palmas abertas explicativas, o polegar abre lateralmente de forma acolhedora.
  // Quando thumbUp está ativo (meta/indicadores), eleva-se verticalmente com firmeza.
  // Em repouso (open próximo de 0), descansa alinhado sem flexionar para dentro da calça:
  const thb1Z = isLeft ? (0.15 * open - 0.06 * (1 - open)) : (-0.15 * open + 0.06 * (1 - open) - 0.24 * up);
  const thb2X = -0.18 * open - 0.04 * (1 - open) - 0.32 * up;
  const thb3X = -0.12 * open - 0.02 * (1 - open) - 0.18 * up;

  applyBone(side + "Thumb1", 0, 0, thb1Z, speed, delta);
  applyBone(side + "Thumb2", thb2X, 0, 0, speed, delta);
  applyBone(side + "Thumb3", thb3X, 0, 0, speed, delta);
}

function getGesturePose(type) {
  switch (type) {
    case "explain_dual":
      // Kendall/McNeill: Palm-Up Open Hand (PUOH) / Metáfora de conduto
      // Cotovelos a meia distância, palmas abertas para cima oferecendo o conceito
      return {
        leftUpper: armDirections.dualLeftUpper,
        leftLower: armDirections.dualLeftLower,
        rightUpper: armDirections.dualRightUpper,
        rightLower: armDirections.dualRightLower,
        leftTwist: -2.45,
        rightTwist: 2.45,
        leftHand: { x: -0.18, y: 0.22, z: -0.06 },
        rightHand: { x: -0.18, y: -0.22, z: 0.06 },
        leftOpenness: 0.94,
        rightOpenness: 0.94,
        leftPoint: 0.0,
        rightPoint: 0.0,
        leadSide: "both",
      };

    case "explain_wide":
      // Apresentação Ampla (cotovelos mais longe do corpo, palmas bem para cima):
      return {
        leftUpper: armDirections.wideLeftUpper,
        leftLower: armDirections.wideLeftLower,
        rightUpper: armDirections.wideRightUpper,
        rightLower: armDirections.wideRightLower,
        leftTwist: -2.55,
        rightTwist: 2.55,
        leftHand: { x: -0.20, y: 0.25, z: -0.08 },
        rightHand: { x: -0.20, y: -0.25, z: 0.08 },
        leftOpenness: 0.96,
        rightOpenness: 0.96,
        leftPoint: 0.0,
        rightPoint: 0.0,
        leadSide: "both",
      };

    case "hands_together":
      // Mãos à frente do peito com palmas voltadas uma para a outra, mantendo distância elegante sem se cruzarem:
      return {
        id: "hands_together",
        leftUpper: armDirections.prayerLeftUpper,
        leftLower: armDirections.prayerLeftLower,
        rightUpper: armDirections.prayerRightUpper,
        rightLower: armDirections.prayerRightLower,
        leftTwist: -2.09,
        rightTwist: 2.09,
        leftHand: { x: -0.10, y: 0.04, z: 0.0 },
        rightHand: { x: -0.10, y: -0.04, z: 0.0 },
        leftOpenness: 0.82,
        rightOpenness: 0.82,
        leftPoint: 0.0,
        rightPoint: 0.0,
        leadSide: "both",
      };

    case "target_goal":
      // Gesto de Meta e Atingimento de Indicadores:
      // Mão esquerda na horizontal com palma virada para cima (base de apoio / platô de resultados).
      // Mão direita na vertical com a parte inferior tocando a palma da mão esquerda, enquanto o dedão fica para cima.
      return {
        id: "target_goal",
        leftUpper: armDirections.targetGoalLeftUpper,
        leftLower: armDirections.targetGoalLeftLower,
        rightUpper: armDirections.targetGoalRightUpper,
        rightLower: armDirections.targetGoalRightLower,
        leftTwist: -2.55,
        rightTwist: 1.57,
        leftHand: { x: -0.12, y: 0.12, z: -0.04 },
        rightHand: { x: -0.08, y: -0.04, z: 0.04 },
        leftOpenness: 0.95,
        rightOpenness: 0.82,
        leftPoint: 0.0,
        rightPoint: 0.0,
        rightThumbUp: 1.0,
        leadSide: "both",
      };

    case "explain_right":
      // Mão direita dominante com palma para cima; mão esquerda em apoio perto do corpo
      return {
        leftUpper: armDirections.leftSupportUpper,
        leftLower: armDirections.leftSupportLower,
        rightUpper: armDirections.rightLeadUpper,
        rightLower: armDirections.rightLeadLower,
        leftTwist: -1.1,
        rightTwist: 2.45,
        leftHand: { x: 0.05, y: 0.15, z: -0.04 },
        rightHand: { x: -0.18, y: -0.26, z: 0.08 },
        leftOpenness: 0.22,
        rightOpenness: 0.94,
        leftPoint: 0.0,
        rightPoint: 0.06,
        leadSide: "right",
      };

    case "explain_left":
      // Mão esquerda dominante com palma para cima; mão direita em apoio perto do corpo
      return {
        leftUpper: armDirections.leftLeadUpper,
        leftLower: armDirections.leftLeadLower,
        rightUpper: armDirections.rightSupportUpper,
        rightLower: armDirections.rightSupportLower,
        leftTwist: -2.45,
        rightTwist: 1.1,
        leftHand: { x: -0.18, y: 0.26, z: -0.08 },
        rightHand: { x: 0.05, y: -0.15, z: 0.04 },
        leftOpenness: 0.94,
        rightOpenness: 0.22,
        leftPoint: 0.06,
        rightPoint: 0.0,
        leadSide: "left",
      };

    case "emphasis":
      // Gesto de precisão / Ponto focal importante: cotovelo recolhido, palma voltada ao interlocutor
      return {
        leftUpper: armDirections.leftSupportUpper,
        leftLower: armDirections.leftSupportLower,
        rightUpper: armDirections.emphasisRightUpper,
        rightLower: armDirections.emphasisRightLower,
        leftTwist: -1.1,
        rightTwist: 2.2,
        leftHand: { x: 0.05, y: 0.12, z: 0.0 },
        rightHand: { x: -0.20, y: -0.18, z: 0.06 },
        leftOpenness: 0.20,
        rightOpenness: 0.72,
        leftPoint: 0.0,
        rightPoint: 0.42,
        leadSide: "right",
      };

    case "compare":
      // Contraste espacial ("Por um lado... por outro lado"):
      // Cotovelos e mãos em alturas e distâncias assimétricas, palmas para cima
      return {
        leftUpper: armDirections.compareLeftUpper,
        leftLower: armDirections.compareLeftLower,
        rightUpper: armDirections.compareRightUpper,
        rightLower: armDirections.compareRightLower,
        leftTwist: -2.4,
        rightTwist: 2.4,
        leftHand: { x: -0.16, y: 0.22, z: -0.08 },
        rightHand: { x: -0.14, y: -0.22, z: 0.08 },
        leftOpenness: 0.90,
        rightOpenness: 0.90,
        leftPoint: 0.0,
        rightPoint: 0.0,
        leadSide: "both",
      };

    default:
      return getGesturePose("explain_dual");
  }
}

function getContextualGestureDuration(type) {
  switch (type) {
    case "emphasis":
      return 1.3 + Math.random() * 0.6;
    case "explain_right":
    case "explain_left":
      return 1.5 + Math.random() * 0.8;
    case "compare":
      return 1.8 + Math.random() * 0.7;
    case "explain_dual":
    case "explain_wide":
      return 2.0 + Math.random() * 0.8;
    case "hands_together":
    case "target_goal":
      return 2.4 + Math.random() * 1.0;
    default:
      return 1.8 + Math.random() * 0.8;
  }
}

function advanceGesturePhrase(forcedType = null) {
  const gesture = runtime.gesture;
  const minHold = forcedType ? 0.85 : 1.25;
  if (gesture.elapsed < minHold) return false;

  gesture.previousType = gesture.type;
  gesture.elapsed = 0;

  if (forcedType) {
    gesture.type = forcedType;
  } else {
    const current = gesture.type;
    let pool;
    if (current === "explain_right") {
      pool = ["explain_left", "emphasis", "hands_together", "explain_dual"];
    } else if (current === "explain_left") {
      pool = ["explain_right", "compare", "target_goal", "explain_wide"];
    } else if (current === "hands_together") {
      pool = ["explain_wide", "explain_right", "explain_dual", "emphasis"];
    } else if (current === "target_goal") {
      pool = ["explain_right", "explain_wide", "compare", "hands_together"];
    } else if (current === "emphasis") {
      pool = ["explain_dual", "explain_right", "explain_left", "compare"];
    } else {
      pool = ["explain_right", "hands_together", "explain_left", "target_goal", "emphasis", "explain_wide"];
    }
    gesture.type = pool[Math.floor(Math.random() * pool.length)];
  }

  gesture.duration = getContextualGestureDuration(gesture.type);
  gesture.blend = 0;
  gesture.strength = 0.84 + Math.random() * 0.16;
  return true;
}

function triggerTargetGoalGesture() {
  if (runtime.gesture.type === "target_goal" && runtime.gesture.blend < 0.7) return;
  runtime.gesture.previousType = runtime.gesture.type;
  runtime.gesture.type = "target_goal";
  runtime.gesture.blend = 0;
  runtime.gesture.elapsed = 0;
  runtime.gesture.duration = 4.5;
}

function smoothPulse(value, start, end) {
  if (value <= start || value >= end) return 0;
  return Math.sin(((value - start) / (end - start)) * Math.PI) ** 2;
}

function animateProceduralMouth() {
  runtime.proceduralMouth?.update(runtime.mouthOpen, runtime.mouthRound);
}

function animateMouth(delta, level) {
  runtime.mouthPeak = Math.max(level, THREE.MathUtils.damp(runtime.mouthPeak, 0.08, 3.5, delta));
  const voiced = THREE.MathUtils.smoothstep(level, 0.008, 0.045);
  const syllable = voiced * THREE.MathUtils.smoothstep(level / Math.max(0.08, runtime.mouthPeak), 0.3, 0.82);
  const opening = runtime.hasClosedMouth ? syllable * 0.82 : Math.min(syllable * 0.28, 0.28);
  runtime.mouthOpen = THREE.MathUtils.damp(runtime.mouthOpen, opening, opening > runtime.mouthOpen ? 42 : 55, delta);
  if (runtime.mouthOpen < 0.0001) runtime.mouthOpen = 0;
  const rounded = THREE.MathUtils.clamp(runtime.mouthRound, 0, 1);
  for (const target of runtime.mouthTargets) {
    const name = target.name.replace(/[^a-z0-9]/g, "");
    let weight = 0;
    if (runtime.hasClosedMouth) {
      if (name === "mouthclosed") weight = 1 - runtime.mouthOpen;
      else if (name === "moutho") weight = runtime.mouthOpen * rounded * 0.045;
      else if (name === "mouthu") weight = runtime.mouthOpen * rounded * 0.025;
      target.mesh.morphTargetInfluences[target.index] = weight;
      continue;
    }
    if (name === "jawopen" || name === "mouthopen") weight = 0.55;
    else if (name === "moutha") weight = (1 - rounded) * 0.28;
    else if (name === "mouthe") weight = (1 - rounded) * 0.17;
    else if (name === "moutho") weight = rounded * 0.27;
    else if (name === "mouthu") weight = rounded * 0.18;
    const value = THREE.MathUtils.damp(target.mesh.morphTargetInfluences[target.index], runtime.mouthOpen * weight, 30, delta);
    target.mesh.morphTargetInfluences[target.index] = value < 0.0001 ? 0 : value;
  }
  if (runtime.mouthMode === "jaw") applyBone("jaw", runtime.mouthOpen * 0.08, 0, 0, 24, delta);
  animateProceduralMouth();
}


function animateBody(time, delta) {
  if (!runtime.model) return;
  const now = performance.now();
  const demoActive = runtime.demoUntil > now;
  const mode = demoActive ? "speaking" : runtime.mode;
  const speaking = demoActive || runtime.audioActive || (!runtime.userSpeaking && runtime.lastAudibleAt > 0 && now - runtime.lastAudibleAt < 650);
  const listening = mode === "listening";
  const thinking = mode === "thinking" && !speaking;
  const greeting = mode === "greeting";
  const idle = !speaking && !listening && !thinking && !greeting;

  // 1. Envelope Respiratório Conversacional (inspiração ágil e expansiva, expiração suave durante fala):
  runtime.kinetics.speechBreathPhase += delta * (speaking ? 1.45 : 1.15);
  const breathCycle = Math.sin(runtime.kinetics.speechBreathPhase);
  const speechChestExpand = speaking ? (Math.max(0, breathCycle) * 0.024 - Math.max(0, -breathCycle) * 0.010) : (breathCycle * 0.012);

  const demoPhrase = demoActive ? smoothPulse(runtime.gestureTime % 4.0, 0.1, 3.8) : 0;
  const demoSyllable = Math.max(0, Math.sin(runtime.gestureTime * 14) + 0.3 * Math.sin(runtime.gestureTime * 22));
  const energy = demoActive ? demoPhrase * demoSyllable * 0.42 : runtime.audioLevel;

  // Transição progressiva de entrada e saída do estado de gesticulação geral (Preparation & Recovery):
  const gestureTarget = speaking ? 1 : 0;
  runtime.gestureLevel = THREE.MathUtils.damp(runtime.gestureLevel, gestureTarget, speaking ? 3.6 : 2.4, delta);
  if (speaking) runtime.gestureTime += delta;

  // 2. Frases gestuais comunicativas e dinâmicas (Kendon Gesture Units & McNeill Dimensions):
  const gesture = runtime.gesture;
  gesture.elapsed += delta;

  if (demoActive) {
    if (gesture.elapsed >= 2.4) {
      advanceGesturePhrase();
      const label = gesture.type === "hands_together" ? "Demonstrando mãos próximas e diálogo" :
                    gesture.type === "target_goal" ? "Demonstrando meta e atingimento de indicadores" :
                    gesture.type === "explain_wide" ? "Demonstrando apresentação aberta com palmas para cima" :
                    gesture.type === "emphasis" ? "Demonstrando ênfase e ponto importante" :
                    gesture.type === "compare" ? "Demonstrando comparação e contraste" :
                    "Demonstrando postura didática ativa";
      setActivity("speaking", label);
    }
  } else if (speaking) {
    // Detecção de pausa respiratória na voz entre orações:
    if (energy < 0.02) {
      runtime.voicePauseTime = (runtime.voicePauseTime || 0) + delta;
      if (runtime.voicePauseTime > 0.28 && gesture.elapsed >= 1.5 && gesture.blend >= 0.85) {
        advanceGesturePhrase();
        runtime.voicePauseTime = 0;
      }
    } else {
      runtime.voicePauseTime = 0;
    }

    if (gesture.elapsed >= gesture.duration) {
      advanceGesturePhrase();
    }
  }

  // Crossfade fluido e ágil entre posturas explicativas:
  gesture.blend = Math.min(1, gesture.blend + delta * 2.0);
  const phraseBlend = gesture.blend * gesture.blend * (3 - 2 * gesture.blend); // smoothstep

  const prevPose = getGesturePose(gesture.previousType || "explain_dual");
  const targetPose = getGesturePose(gesture.type || "explain_dual");
  const activeLeadSide = phraseBlend > 0.5 ? targetPose.leadSide : prevPose.leadSide;
  gesture.leadSide = activeLeadSide;

  const speakingStrength = runtime.gestureLevel * gesture.strength;

  // 3. Gerador de Beats Prosódicos Orgânicos e Cadência Harmônica Afirmativa:
  const kinetics = runtime.kinetics;
  if (speaking) {
    if (energy > 0.04) {
      kinetics.beatImpulse = Math.min(1.0, kinetics.beatImpulse + energy * delta * 12.0);
    }
    const syllableWave = Math.sin(runtime.gestureTime * 3.2) * Math.sin(runtime.gestureTime * 1.6 + 0.4);
    kinetics.beatPulse = THREE.MathUtils.damp(kinetics.beatPulse, Math.max(0, syllableWave), 6.0, delta);

    // Cadência conversacional afirmativa: avança com ritmo orgânico impulsionado pela voz:
    const affirmCadenceSpeed = 1.95 + energy * 1.4;
    kinetics.affirmPhase = (kinetics.affirmPhase || 0) + delta * affirmCadenceSpeed;
    kinetics.affirmEnvelope = THREE.MathUtils.damp(kinetics.affirmEnvelope || 0, 1.0, 3.5, delta);
  } else {
    kinetics.beatImpulse = THREE.MathUtils.damp(kinetics.beatImpulse, 0, 8.0, delta);
    kinetics.beatPulse = THREE.MathUtils.damp(kinetics.beatPulse, 0, 8.0, delta);
    kinetics.affirmEnvelope = THREE.MathUtils.damp(kinetics.affirmEnvelope || 0, 0, 3.8, delta);
  }
  kinetics.beatImpulse = THREE.MathUtils.damp(kinetics.beatImpulse, 0, 4.8, delta);
  const organicBeat = (kinetics.beatPulse * 0.45 + kinetics.beatImpulse * 0.55) * speakingStrength;

  // Onda harmônica alternada para afirmação natural (uma mão sobe, a outra desce, e voltam à posição base):
  const rawAffirmSine = Math.sin(kinetics.affirmPhase || 0);
  const shapedAffirm = Math.sign(rawAffirmSine) * Math.pow(Math.abs(rawAffirmSine), 1.25);
  kinetics.affirmWave = shapedAffirm * (kinetics.affirmEnvelope || 0) * speakingStrength;

  // 4. Contrapposto Natural com Pés 100% Estáveis no Chão:
  const posture = runtime.posture;
  posture.shiftTimer -= delta;
  if (speaking) {
    if (posture.shiftTimer <= 0) {
      posture.targetWeightShift = (posture.targetWeightShift <= 0 ? 1 : -1) * (0.65 + Math.random() * 0.25);
      posture.shiftTimer = 6.5 + Math.random() * 3.5;
    }
  } else if (idle || listening) {
    if (posture.shiftTimer <= 0) {
      posture.targetWeightShift = (posture.targetWeightShift <= 0 ? 1 : -1) * (0.55 + Math.random() * 0.3);
      posture.shiftTimer = 14.0 + Math.random() * 8.0;
    }
  }

  // Transição contínua com suavização orgânica:
  posture.weightShift = THREE.MathUtils.damp(posture.weightShift, posture.targetWeightShift, 1.4, delta);
  const factorRight = Math.max(0, posture.weightShift);
  const factorLeft = Math.max(0, -posture.weightShift);

  // 5. Tronco, Coluna e Cabeça (Cadeia Cinética Integrada):
  const bodyLean = listening ? 0.040 : thinking ? -0.015 : (0.024 + speakingStrength * 0.020);
  const activeSideBias = gesture.leadSide === "right" ? 1 : gesture.leadSide === "left" ? -1 : 0;
  const torsoTurn = activeSideBias * speakingStrength * 0.048;
  const chestRoll = activeSideBias * speakingStrength * 0.018;

  // Micro-acenos de cabeça afirmativos e acolhedores (professor):
  posture.nodTimer -= delta;
  if (posture.nodTimer <= 0) {
    posture.headNod = 1.0;
    posture.nodTimer = speaking ? (3.0 + Math.random() * 2.2) : (4.5 + Math.random() * 3.5);
  }
  posture.headNod = THREE.MathUtils.damp(posture.headNod, 0, 4.0, delta);

  let headPitch = (listening ? 0.045 : 0.014) + (speakingStrength * 0.016) + (posture.headNod * 0.032) + (organicBeat * 0.022);
  let headYaw = (thinking ? -0.02 : -torsoTurn * 0.60);
  let headRoll = (thinking ? 0.015 : (listening ? -0.03 : activeSideBias * 0.022));
  let neckPitch = (listening ? 0.032 : 0.010) + (speakingStrength * 0.012) + (organicBeat * 0.010);

  // Preparação das pernas (flexão de joelhos orgânica, contrapposto dinâmico e pés 100% estáveis):
  const freeKneeBase = 0.065;
  const freeKneeDynamic = (Math.sin(time * 1.9) * 0.024 + energy * 0.030) * speakingStrength;
  const totalFreeKneeFlex = freeKneeBase + freeKneeDynamic;
  const speechKneeDip = (Math.sin(time * 2.3) * 0.014 + Math.max(0, energy - 0.06) * 0.028) * speakingStrength;

  legPose.leftUpper.copy(legDirections.leftThighNeutral);
  legPose.leftLower.copy(legDirections.leftShinNeutral);
  legPose.rightUpper.copy(legDirections.rightThighNeutral);
  legPose.rightLower.copy(legDirections.rightShinNeutral);

  if (factorRight > 0.001) {
    legPose.rightUpper.lerp(legDirections.rightThighFirm, factorRight);
    legPose.rightLower.lerp(legDirections.rightShinFirm, factorRight);
    legPose.leftUpper.lerp(legDirections.leftThighRelaxed, factorRight);
    legPose.leftLower.lerp(legDirections.leftShinRelaxed, factorRight);

    legPose.leftUpper.z += factorRight * totalFreeKneeFlex;
    legPose.leftLower.z -= factorRight * (totalFreeKneeFlex * 1.35);
  } else if (factorLeft > 0.001) {
    legPose.leftUpper.lerp(legDirections.leftThighFirm, factorLeft);
    legPose.leftLower.lerp(legDirections.leftShinFirm, factorLeft);
    legPose.rightUpper.lerp(legDirections.rightThighRelaxed, factorLeft);
    legPose.rightLower.lerp(legDirections.rightShinRelaxed, factorLeft);

    legPose.rightUpper.z += factorLeft * totalFreeKneeFlex;
    legPose.rightLower.z -= factorLeft * (totalFreeKneeFlex * 1.35);
  }

  legPose.leftUpper.z += speechKneeDip * 0.35;
  legPose.leftLower.z -= speechKneeDip * 0.50;
  legPose.rightUpper.z += speechKneeDip * 0.35;
  legPose.rightLower.z -= speechKneeDip * 0.50;

  // Compensação para solas dos pés 100% planas no chão:
  let leftFootPitch = (factorRight > 0.001 ? factorRight * (0.045 + totalFreeKneeFlex * 0.65) : 0) + speechKneeDip * 0.28;
  let rightFootPitch = (factorLeft > 0.001 ? factorLeft * (0.045 + totalFreeKneeFlex * 0.65) : 0) + speechKneeDip * 0.28;
  let leftFootRoll = -posture.weightShift * 0.032;
  let rightFootRoll = -posture.weightShift * 0.032;

  // Pelve (Hips):
  let hipsX = posture.weightShift * 0.022;
  let hipsY = breathCycle * 0.0018 - Math.abs(posture.weightShift) * 0.0025 - speechKneeDip * 0.012 - (factorRight + factorLeft) * totalFreeKneeFlex * 0.007;
  let hipsTilt = bodyLean * 0.35 + breathCycle * 0.002 + speechKneeDip * 0.015;
  let hipsRoll = posture.weightShift * 0.038;
  let hipsYaw = torsoTurn * 0.4 + posture.weightShift * 0.015;

  applyBone("hips", hipsTilt, hipsRoll, hipsYaw, 5.5, delta);
  translateBone("hips", hipsX, hipsY, 0, 5, delta);

  // Coluna em cadeia articulada distribuída:
  const spineCompRoll = -posture.weightShift * 0.026;
  applyBone("spine", bodyLean * 0.35, torsoTurn * 0.25, spineCompRoll, 5.0, delta);
  applyBone("spine1", bodyLean * 0.40, torsoTurn * 0.45, spineCompRoll * 0.7 - chestRoll * 0.3, 5.0, delta);
  applyBone("spine2", bodyLean * 0.35 + speechChestExpand + organicBeat * 0.016, torsoTurn * 0.85, chestRoll, 5.0, delta);
  applyBone("neck", neckPitch, 0, 0, 5.0, delta);
  applyBone("head", headPitch, headYaw, headRoll, 5.0, delta);

  legPose.leftUpper.normalize();
  legPose.leftLower.normalize();
  legPose.rightUpper.normalize();
  legPose.rightLower.normalize();

  aimBone("leftUpLeg", "leftLeg", legPose.leftUpper, 6, delta);
  aimBone("rightUpLeg", "rightLeg", legPose.rightUpper, 6, delta);
  aimBone("leftLeg", "leftFoot", legPose.leftLower, 6, delta);
  aimBone("rightLeg", "rightFoot", legPose.rightLower, 6, delta);

  applyBone("leftFoot", leftFootPitch, 0, leftFootRoll, 6, delta);
  applyBone("rightFoot", rightFootPitch, 0, rightFootRoll, 6, delta);
  applyBone("leftToeBase", 0, 0, 0, 6, delta);
  applyBone("rightToeBase", 0, 0, 0, 6, delta);

  // 6. Braços, Cotovelos, Mãos e Dedos:
  const waitingFactor = Math.max(0, 1 - runtime.gestureLevel);
  const breathSwayUpperZ = (breathCycle * 0.020 + Math.cos(time * 0.68) * 0.010) * waitingFactor;
  const breathSwayUpperX = (Math.sin(time * 0.92) * 0.012) * waitingFactor;
  const breathSwayLowerZ = (Math.sin(time * 1.35 - 0.45) * 0.025) * waitingFactor;
  const idleFingersCurl = (0.04 + Math.sin(time * 1.1) * 0.020) * waitingFactor;
  const idleWristBreath = Math.sin(time * 1.35) * 0.015 * waitingFactor;

  const restAsymmetryLeft = (factorLeft * 0.014 - factorRight * 0.008) * waitingFactor;
  const restAsymmetryRight = (factorRight * 0.014 - factorLeft * 0.008) * waitingFactor;

  tmpVecA.set(
    armDirections.idleLeftUpper.x + breathSwayUpperX,
    armDirections.idleLeftUpper.y,
    armDirections.idleLeftUpper.z + breathSwayUpperZ + restAsymmetryLeft
  ).normalize();

  tmpVecB.set(
    armDirections.idleLeftLower.x + breathSwayUpperX * 0.5,
    armDirections.idleLeftLower.y,
    armDirections.idleLeftLower.z + breathSwayLowerZ + restAsymmetryLeft * 1.2
  ).normalize();

  tmpVecC.set(
    armDirections.idleRightUpper.x - breathSwayUpperX,
    armDirections.idleRightUpper.y,
    armDirections.idleRightUpper.z + breathSwayUpperZ + restAsymmetryRight
  ).normalize();

  tmpVecD.set(
    armDirections.idleRightLower.x - breathSwayUpperX * 0.5,
    armDirections.idleRightLower.y,
    armDirections.idleRightLower.z + breathSwayLowerZ + restAsymmetryRight * 1.2
  ).normalize();

  // Interpolação contínua entre posturas de fala:
  speakingPose.leftUpper.lerpVectors(prevPose.leftUpper, targetPose.leftUpper, phraseBlend);
  speakingPose.leftLower.lerpVectors(prevPose.leftLower, targetPose.leftLower, phraseBlend);
  speakingPose.rightUpper.lerpVectors(prevPose.rightUpper, targetPose.rightUpper, phraseBlend);
  speakingPose.rightLower.lerpVectors(prevPose.rightLower, targetPose.rightLower, phraseBlend);

  let spkLeftTwist = THREE.MathUtils.lerp(prevPose.leftTwist ?? 0, targetPose.leftTwist ?? 0, phraseBlend);
  let spkRightTwist = THREE.MathUtils.lerp(prevPose.rightTwist ?? 0, targetPose.rightTwist ?? 0, phraseBlend);

  let spkLeftHandX = THREE.MathUtils.lerp(prevPose.leftHand.x, targetPose.leftHand.x, phraseBlend);
  let spkLeftHandY = THREE.MathUtils.lerp(prevPose.leftHand.y, targetPose.leftHand.y, phraseBlend);
  let spkLeftHandZ = THREE.MathUtils.lerp(prevPose.leftHand.z, targetPose.leftHand.z, phraseBlend);

  let spkRightHandX = THREE.MathUtils.lerp(prevPose.rightHand.x, targetPose.rightHand.x, phraseBlend);
  let spkRightHandY = THREE.MathUtils.lerp(prevPose.rightHand.y, targetPose.rightHand.y, phraseBlend);
  let spkRightHandZ = THREE.MathUtils.lerp(prevPose.rightHand.z, targetPose.rightHand.z, phraseBlend);

  let spkLeftOpen = THREE.MathUtils.lerp(prevPose.leftOpenness, targetPose.leftOpenness, phraseBlend);
  let spkRightOpen = THREE.MathUtils.lerp(prevPose.rightOpenness, targetPose.rightOpenness, phraseBlend);
  let spkLeftPoint = THREE.MathUtils.lerp(prevPose.leftPoint, targetPose.leftPoint, phraseBlend);
  let spkRightPoint = THREE.MathUtils.lerp(prevPose.rightPoint, targetPose.rightPoint, phraseBlend);
  let spkRightThumbUp = THREE.MathUtils.lerp(prevPose.rightThumbUp ?? 0, targetPose.rightThumbUp ?? 0, phraseBlend);

  const targetIsHandsTogether = (targetPose.id === "hands_together" || gesture.type === "hands_together") ? 1 : 0;
  const prevIsHandsTogether = (prevPose.id === "hands_together" || gesture.previousType === "hands_together") ? 1 : 0;
  const handsTogetherWeight = THREE.MathUtils.lerp(prevIsHandsTogether, targetIsHandsTogether, phraseBlend);

  const targetIsTargetGoal = (targetPose.id === "target_goal" || gesture.type === "target_goal") ? 1 : 0;
  const prevIsTargetGoal = (prevPose.id === "target_goal" || gesture.previousType === "target_goal") ? 1 : 0;
  const targetGoalWeight = THREE.MathUtils.lerp(prevIsTargetGoal, targetIsTargetGoal, phraseBlend);

  // Batons e acentos comunicativos assimétricos:
  const leadWeightL = (activeLeadSide === "left" || activeLeadSide === "both") ? 1.0 : 0.40;
  const leadWeightR = (activeLeadSide === "right" || activeLeadSide === "both") ? 1.0 : 0.40;

  const beatForearmYL = organicBeat * 0.024 * leadWeightL;
  const beatForearmZL = organicBeat * 0.016 * leadWeightL;
  const beatWristXL = -organicBeat * 0.040 * leadWeightL;

  const beatForearmYR = organicBeat * 0.024 * leadWeightR;
  const beatForearmZR = organicBeat * 0.016 * leadWeightR;
  const beatWristXR = -organicBeat * 0.040 * leadWeightR;

  // Movimento de afirmação harmônica alternada:
  // "uma mao desce outra sobe e depois volta para a posicao anterior, para afirmar e naturalizar os movimentos"
  // Respeita posturas com mãos em contato (hands_together ou target_goal) desacoplando a alternância vertical:
  const openHandsWeight = Math.max(0, 1 - Math.max(handsTogetherWeight, targetGoalWeight));
  const affirmMotion = (kinetics.affirmWave || 0) * openHandsWeight;

  const affirmAmpRise = 0.125;
  const affirmAmpDrop = 0.085;

  let affirmDeltaYL = 0;
  let affirmDeltaZL = 0;
  let affirmUpperYL = 0;
  let affirmUpperZL = 0;
  let affirmWristXL = 0;
  let affirmOpenL = 0;

  let affirmDeltaYR = 0;
  let affirmDeltaZR = 0;
  let affirmUpperYR = 0;
  let affirmUpperZR = 0;
  let affirmWristXR = 0;
  let affirmOpenR = 0;

  if (affirmMotion > 0.0001) {
    // Mão direita sobe para afirmar, mão esquerda desce suavemente:
    const riseR = affirmMotion * leadWeightR;
    const dropL = affirmMotion * leadWeightL;

    affirmDeltaYR = riseR * affirmAmpRise;
    affirmDeltaZR = riseR * 0.045;
    affirmUpperYR = riseR * 0.035;
    affirmUpperZR = riseR * 0.020;
    affirmWristXR = -riseR * 0.085;
    affirmOpenR = riseR * 0.06;

    affirmDeltaYL = -dropL * affirmAmpDrop;
    affirmDeltaZL = -dropL * 0.022;
    affirmUpperYL = -dropL * 0.025;
    affirmUpperZL = -dropL * 0.015;
    affirmWristXL = dropL * 0.045;
    affirmOpenL = -dropL * 0.04;
  } else if (affirmMotion < -0.0001) {
    // Mão esquerda sobe para afirmar, mão direita desce suavemente:
    const riseL = -affirmMotion * leadWeightL;
    const dropR = -affirmMotion * leadWeightR;

    affirmDeltaYL = riseL * affirmAmpRise;
    affirmDeltaZL = riseL * 0.045;
    affirmUpperYL = riseL * 0.035;
    affirmUpperZL = riseL * 0.020;
    affirmWristXL = -riseL * 0.085;
    affirmOpenL = riseL * 0.06;

    affirmDeltaYR = -dropR * affirmAmpDrop;
    affirmDeltaZR = -dropR * 0.022;
    affirmUpperYR = -dropR * 0.025;
    affirmUpperZR = -dropR * 0.015;
    affirmWristXR = dropR * 0.045;
    affirmOpenR = -dropR * 0.04;
  }

  if (handsTogetherWeight > 0.001) {
    const prayerCadence = Math.sin(runtime.gestureTime * 3.4);
    const prayerPulse = (Math.max(0, prayerCadence) * 0.024 + energy * 0.038) * handsTogetherWeight;
    const prayerReach = (Math.sin(runtime.gestureTime * 2.0) * 0.020 + energy * 0.028) * handsTogetherWeight;
    const prayerSwayX = Math.sin(runtime.gestureTime * 1.5) * 0.022 * handsTogetherWeight;
    const prayerWristPitch = (-0.06 - prayerPulse * 1.4) * handsTogetherWeight;
    const prayerFingerMod = Math.sin(runtime.gestureTime * 3.4) * 0.04 * handsTogetherWeight;

    speakingPose.leftLower.x += prayerSwayX;
    speakingPose.rightLower.x += prayerSwayX;
    speakingPose.leftLower.y += prayerPulse;
    speakingPose.rightLower.y += prayerPulse;
    speakingPose.leftLower.z += prayerReach;
    speakingPose.rightLower.z += prayerReach;

    spkLeftHandX += prayerWristPitch;
    spkRightHandX += prayerWristPitch;
    spkLeftOpen = THREE.MathUtils.clamp(spkLeftOpen + prayerFingerMod, 0.84, 0.94);
    spkRightOpen = THREE.MathUtils.clamp(spkRightOpen + prayerFingerMod, 0.84, 0.94);
  }

  const openBeatWeight = 1 - handsTogetherWeight;
  if (openBeatWeight > 0.001) {
    speakingPose.leftUpper.y += affirmUpperYL * openBeatWeight;
    speakingPose.leftUpper.z += affirmUpperZL * openBeatWeight;
    speakingPose.leftLower.y += (beatForearmYL + affirmDeltaYL) * openBeatWeight;
    speakingPose.leftLower.z += (beatForearmZL + affirmDeltaZL) * openBeatWeight;
    spkLeftHandX += (beatWristXL + affirmWristXL) * openBeatWeight;
    spkLeftOpen = THREE.MathUtils.clamp(spkLeftOpen + (organicBeat * 0.04 + affirmOpenL) * leadWeightL * openBeatWeight, 0, 1);

    speakingPose.rightUpper.y += affirmUpperYR * openBeatWeight;
    speakingPose.rightUpper.z += affirmUpperZR * openBeatWeight;
    speakingPose.rightLower.y += (beatForearmYR + affirmDeltaYR) * openBeatWeight;
    speakingPose.rightLower.z += (beatForearmZR + affirmDeltaZR) * openBeatWeight;
    spkRightHandX += (beatWristXR + affirmWristXR) * openBeatWeight;
    spkRightOpen = THREE.MathUtils.clamp(spkRightOpen + (organicBeat * 0.04 + affirmOpenR) * leadWeightR * openBeatWeight, 0, 1);
  }

  // 7. Follow-Through Spring nos Punhos (Inércia física secundária que elimina rigidez):
  const dForeArmLY = speakingPose.leftLower.y - kinetics.prevForeArmLeft.y;
  const dForeArmLZ = speakingPose.leftLower.z - kinetics.prevForeArmLeft.z;
  const dForeArmRY = speakingPose.rightLower.y - kinetics.prevForeArmRight.y;
  const dForeArmRZ = speakingPose.rightLower.z - kinetics.prevForeArmRight.z;
  kinetics.prevForeArmLeft.copy(speakingPose.leftLower);
  kinetics.prevForeArmRight.copy(speakingPose.rightLower);

  const wristImpulseLX = (-dForeArmLY * 2.2 - dForeArmLZ * 1.5) * runtime.gestureLevel;
  const wristImpulseRX = (-dForeArmRY * 2.2 - dForeArmRZ * 1.5) * runtime.gestureLevel;

  kinetics.leftWristLag.vx += wristImpulseLX * 14.0;
  kinetics.leftWristLag.vx -= kinetics.leftWristLag.x * 38.0 * delta;
  kinetics.leftWristLag.vx -= kinetics.leftWristLag.vx * 14.0 * delta;
  kinetics.leftWristLag.x += kinetics.leftWristLag.vx * delta;

  kinetics.rightWristLag.vx += wristImpulseRX * 14.0;
  kinetics.rightWristLag.vx -= kinetics.rightWristLag.x * 38.0 * delta;
  kinetics.rightWristLag.vx -= kinetics.rightWristLag.vx * 14.0 * delta;
  kinetics.rightWristLag.x += kinetics.rightWristLag.vx * delta;

  spkLeftHandX += kinetics.leftWristLag.x;
  spkRightHandX += kinetics.rightWristLag.x;

  speakingPose.leftUpper.normalize();
  speakingPose.leftLower.normalize();
  speakingPose.rightUpper.normalize();
  speakingPose.rightLower.normalize();

  // Interpolação de Preparation & Recovery:
  armPose.leftUpper.lerpVectors(tmpVecA, speakingPose.leftUpper, runtime.gestureLevel);
  armPose.leftLower.lerpVectors(tmpVecB, speakingPose.leftLower, runtime.gestureLevel);
  armPose.rightUpper.lerpVectors(tmpVecC, speakingPose.rightUpper, runtime.gestureLevel);
  armPose.rightLower.lerpVectors(tmpVecD, speakingPose.rightLower, runtime.gestureLevel);

  let currentLeftTwist = THREE.MathUtils.lerp(-0.35, spkLeftTwist, runtime.gestureLevel);
  let currentRightTwist = THREE.MathUtils.lerp(0.35, spkRightTwist, runtime.gestureLevel);

  const elbowDamp = 1 - handsTogetherWeight * 0.65;
  const elbowBreathe = Math.sin(time * 1.5) * 0.022 * runtime.gestureLevel * elbowDamp;
  armPose.leftUpper.x += elbowBreathe;
  armPose.rightUpper.x -= elbowBreathe;

  const idleLeftHandX = 0.03 + idleWristBreath;
  const idleLeftHandZ = 0.07;
  const idleRightHandX = 0.03 + idleWristBreath;
  const idleRightHandZ = -0.07;

  let leftHandX = THREE.MathUtils.lerp(idleLeftHandX, spkLeftHandX, runtime.gestureLevel);
  let leftHandY = THREE.MathUtils.lerp(0, spkLeftHandY, runtime.gestureLevel);
  let leftHandZ = THREE.MathUtils.lerp(idleLeftHandZ, spkLeftHandZ, runtime.gestureLevel);

  let rightHandX = THREE.MathUtils.lerp(idleRightHandX, spkRightHandX, runtime.gestureLevel);
  let rightHandY = THREE.MathUtils.lerp(0, spkRightHandY, runtime.gestureLevel);
  let rightHandZ = THREE.MathUtils.lerp(idleRightHandZ, spkRightHandZ, runtime.gestureLevel);

  let leftOpenness = THREE.MathUtils.lerp(idleFingersCurl, spkLeftOpen, runtime.gestureLevel);
  let rightOpenness = THREE.MathUtils.lerp(idleFingersCurl, spkRightOpen, runtime.gestureLevel);
  let leftPoint = THREE.MathUtils.lerp(0, spkLeftPoint, runtime.gestureLevel);
  let rightPoint = THREE.MathUtils.lerp(0, spkRightPoint, runtime.gestureLevel);
  let currentRightThumbUp = THREE.MathUtils.lerp(0, spkRightThumbUp, runtime.gestureLevel);

  // Modos especiais (saudação, pensamento e escuta):
  const welcomeTime = greeting ? (performance.now() - runtime.modeStartedAt) / 1000 : 99;
  const wave = greeting && welcomeTime < 3.4 ? Math.sin(welcomeTime * 7.5) : 0;
  const greetingWeight = greeting ? Math.max(0, 1 - Math.max(0, welcomeTime - 3.0) / 0.5) : 0;

  if (greetingWeight > 0.01) {
    armPose.rightUpper.lerp(armDirections.waveRightUpper, greetingWeight);
    armPose.rightLower.lerp(armDirections.waveRightLower, greetingWeight);
    rightHandX = wave * 0.32 * greetingWeight;
    rightOpenness = 0.9 * greetingWeight;
  } else if (thinking) {
    // Postura atenta, natural e acolhedora de escuta/reflexão enquanto prepara a resposta:
    armPose.rightUpper.lerp(armDirections.thinkRightUpper, 0.85);
    armPose.rightLower.lerp(armDirections.thinkRightLower, 0.85);
    armPose.leftUpper.lerp(armDirections.thinkLeftUpper, 0.85);
    armPose.leftLower.lerp(armDirections.thinkLeftLower, 0.85);
    rightHandX = 0.04;
    rightHandY = 0;
    rightHandZ = -0.04;
    leftHandX = 0.04;
    leftHandY = 0;
    leftHandZ = 0.04;
    rightOpenness = 0.58;
    leftOpenness = 0.58;
  } else if (listening) {
    armPose.leftUpper.lerp(armDirections.listenLeftUpper, 0.88);
    armPose.leftLower.lerp(armDirections.listenLeftLower, 0.88);
    armPose.rightUpper.lerp(armDirections.listenRightUpper, 0.88);
    armPose.rightLower.lerp(armDirections.listenRightLower, 0.88);
    leftHandX = 0.06;
    rightHandX = 0.06;
    leftOpenness = 0.12;
    rightOpenness = 0.12;
  }

  armPose.leftUpper.normalize();
  armPose.leftLower.normalize();
  armPose.rightUpper.normalize();
  armPose.rightLower.normalize();

  // 8. Clavículas/Ombros Ativos (acompanhando alcance frontal e elevação dos braços):
  const shoulderReachL = (armPose.leftUpper.z > 0.25 ? (armPose.leftUpper.z - 0.25) * 0.12 : 0) * runtime.gestureLevel;
  const shoulderReachR = (armPose.rightUpper.z > 0.25 ? (armPose.rightUpper.z - 0.25) * 0.12 : 0) * runtime.gestureLevel;
  const shoulderLiftL = (armPose.leftLower.y > 0 ? armPose.leftLower.y * 0.06 : 0) * runtime.gestureLevel;
  const shoulderLiftR = (armPose.rightLower.y > 0 ? armPose.rightLower.y * 0.06 : 0) * runtime.gestureLevel;

  applyBone("leftShoulder", 0, shoulderReachL * 0.08, -shoulderLiftL + speechChestExpand * 0.2, 4.8, delta);
  applyBone("rightShoulder", 0, -shoulderReachR * 0.08, shoulderLiftR - speechChestExpand * 0.2, 4.8, delta);

  aimBone("leftArm", "leftForeArm", armPose.leftUpper, 6.5, delta);
  aimBone("rightArm", "rightForeArm", armPose.rightUpper, 6.5, delta);
  aimBone("leftForeArm", "leftHand", armPose.leftLower, 7.5, delta, currentLeftTwist);
  aimBone("rightForeArm", "rightHand", armPose.rightLower, 7.5, delta, currentRightTwist);

  applyBone("leftHand", leftHandX, leftHandY, leftHandZ, 6.5, delta);
  applyBone("rightHand", rightHandX, rightHandY, rightHandZ, 6.5, delta);

  // Aplicação de dedos coordenada com micro-expansão de fala:
  const dynamicSplayL = organicBeat * 0.06 * leadWeightL;
  const dynamicSplayR = organicBeat * 0.06 * leadWeightR;
  applyFingers("left", leftOpenness, leftPoint, 5.5, delta, 0, dynamicSplayL);
  applyFingers("right", rightOpenness, rightPoint, 5.5, delta, currentRightThumbUp, dynamicSplayR);

  // Expressão facial e boca sincronizada:
  animateMouth(delta, demoActive || runtime.audioActive ? energy : 0);
}


function updateAudioLevel(delta) {
  const now = performance.now();
  if (!runtime.analyser || !runtime.analyserData) {
    runtime.audioLevel = THREE.MathUtils.damp(runtime.audioLevel, 0, 18, delta);
    runtime.mouthRound = THREE.MathUtils.damp(runtime.mouthRound, 0, 14, delta);
    if (!runtime.responseInProgress && runtime.responseFinishedAt && now - runtime.responseFinishedAt > 450 && runtime.mode === "thinking") setActivity("idle");
    return;
  }

  runtime.analyser.getFloatTimeDomainData(runtime.analyserData);
  let sumSquares = 0;
  for (let i = 0; i < runtime.analyserData.length; i += 1) {
    const sample = runtime.analyserData[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / runtime.analyserData.length);
  const normalized = THREE.MathUtils.clamp((rms - 0.006) * 8, 0, 1);
  runtime.audioLevel = THREE.MathUtils.damp(runtime.audioLevel, normalized, normalized > runtime.audioLevel ? 36 : 45, delta);
  if (runtime.analyserFrequencyData) {
    runtime.analyser.getByteFrequencyData(runtime.analyserFrequencyData);
    const binHz = runtime.audioContext.sampleRate / runtime.analyser.fftSize;
    const bandMean = (fromHz, toHz) => {
      const first = Math.max(1, Math.ceil(fromHz / binHz));
      const last = Math.min(runtime.analyserFrequencyData.length, Math.ceil(toHz / binHz));
      let sum = 0;
      for (let index = first; index < last; index += 1) sum += runtime.analyserFrequencyData[index];
      return sum / Math.max(1, last - first);
    };
    const low = bandMean(150, 650);
    const middle = bandMean(650, 2600);
    const spectralRatio = low / Math.max(1, low + middle);
    const roundTarget = normalized > 0.018 ? THREE.MathUtils.clamp((spectralRatio - 0.42) * 2.8, 0, 1) : 0;
    runtime.mouthRound = THREE.MathUtils.damp(runtime.mouthRound, roundTarget, 14, delta);
  }

  if (normalized > 0.018 && !runtime.userSpeaking) {
    runtime.lastAudibleAt = now;
    if (!runtime.audioActive) {
      runtime.audioActive = true;
      setActivity("speaking");
    }
  } else if (runtime.audioActive && (runtime.userSpeaking || now - runtime.lastAudibleAt > 220)) {
    runtime.audioActive = false;
    if (runtime.mode === "speaking") setActivity(runtime.responseInProgress ? "thinking" : "idle");
  }
  if (!runtime.audioActive && !runtime.responseInProgress && runtime.responseFinishedAt && now - runtime.responseFinishedAt > 450 && runtime.mode === "thinking") setActivity("idle");
}

function setActivity(mode, customText = "") {
  if (runtime.mode !== mode) {
    runtime.previousMode = runtime.mode;
    runtime.mode = mode;
    runtime.modeStartedAt = performance.now();
  }
  const labels = {
    idle: [runtime.connected ? "Conectado" : "Em repouso", runtime.connected ? (runtime.connectionMode === "text" ? "Pronto para digitar" : "Pronto para ouvir") : "Pronto para conversar"],
    listening: ["Ouvindo você", "Pode falar, estou aqui"], thinking: ["Pensando", "Preparando uma resposta"],
    speaking: ["Conversando", "Robbyson está falando"], greeting: ["Boas-vindas", "Que bom ter você aqui"],
  };
  const [label, text] = labels[mode] || labels.idle;
  ui.activityLabel.textContent = label;
  ui.activityText.textContent = customText || text;
  ui.presenceOrb.dataset.mode = mode;
}

function resizeRenderer() {
  const rect = ui.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const aspect = rect.width / rect.height;
  camera.aspect = aspect;
  if (aspect < 0.92) {
    camera.fov = Math.min(46, 32 / Math.max(aspect * 1.15, 0.65));
    controls.target.set(0, 1.35, 0);
  } else {
    camera.fov = 32;
    controls.target.set(0, 1.42, 0);
  }
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height, false);
}
new ResizeObserver(resizeRenderer).observe(ui.canvas.parentElement);

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  updateAudioLevel(delta);
  animateBody(time, delta);
  animateKpiBackdrop(time);
  particles.rotation.y = time * 0.025;
  controls.update();
  renderer.render(scene, camera);
}


async function connect(mode = "text") {
  if (runtime.connected) { disconnect(); return; }
  if (runtime.connecting) return;
  runtime.demoUntil = 0;
  runtime.connecting = true;
  runtime.connectionMode = mode;
  setConnectionUi("connecting");
  showNotice("");
  try {
    if (mode === "voice" && !navigator.mediaDevices?.getUserMedia) {
      if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        throw new Error("O navegador do celular bloqueia o microfone em HTTP. Acesse via HTTPS (porta 8443) ou use a conversa por texto.");
      }
      throw new Error("Este navegador não oferece acesso ao microfone. Use a conversa por texto.");
    }
    const tokenResponse = await fetch("/api/realtime/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ui.modelSelect.value, voice: ui.voiceSelect.value, mode }),
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) throw new Error(tokenData.error || "Não foi possível iniciar a sessão de voz.");
    const ephemeralKey = tokenData.value || tokenData.client_secret?.value;
    if (!ephemeralKey) throw new Error("O servidor não retornou um token de sessão válido.");

    const peer = new RTCPeerConnection();
    runtime.peer = peer;
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState) && runtime.connected) disconnect("A conexão de voz foi encerrada.");
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      ui.remoteAudio.srcObject = stream;
      ui.remoteAudio.play().catch(() => showNotice("O navegador bloqueou o áudio. Clique em Áudio para ativá-lo."));
      setupAudioAnalysis(stream);
    };
    if (mode === "voice") {
      runtime.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      for (const track of runtime.localStream.getTracks()) peer.addTrack(track, runtime.localStream);
    } else {
      // Negotiate the assistant's audio track without requesting an input device.
      peer.addTransceiver("audio", { direction: "recvonly" });
    }

    const channel = peer.createDataChannel("oai-events");
    runtime.channel = channel;
    channel.addEventListener("message", handleRealtimeEvent);
    channel.addEventListener("open", () => {
      runtime.connected = true;
      runtime.connecting = false;
      setConnectionUi("online");
      if (mode === "voice") {
        setActivity("greeting");
        sendEvent({ type: "response.create", response: { instructions: "Cumprimente de forma muito breve e acolhedora em apenas uma frase: 'Oi! Sou o Robbyson, seu coach na AeC. Como posso ajudar seu atendimento hoje?'. Fale AeC como 'a i c'." } });
      } else {
        setActivity("idle");
        ui.messageInput.focus();
      }
    });
    channel.addEventListener("close", () => { if (runtime.connected) disconnect("A sessão foi encerrada."); });

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST", body: offer.sdp,
      headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
    });
    if (!sdpResponse.ok) throw new Error(`A OpenAI recusou a conexão de voz (${sdpResponse.status}).`);
    await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
  } catch (error) {
    console.error(error);
    cleanupConnection();
    runtime.connecting = false;
    runtime.connected = false;
    runtime.connectionMode = null;
    setConnectionUi("offline");
    setActivity("idle");
    showNotice(error.message || "Falha ao conectar.");
  }
}

function disconnect(message = "") {
  cleanupConnection();
  runtime.connected = false;
  runtime.connecting = false;
  runtime.connectionMode = null;
  runtime.muted = false;
  setConnectionUi("offline");
  setActivity("idle");
  if (message) showNotice(message);
}

function cleanupConnection() {
  if (runtime.channel) {
    runtime.channel.removeEventListener("message", handleRealtimeEvent);
    try { runtime.channel.close(); } catch {}
  }
  if (runtime.peer) { try { runtime.peer.close(); } catch {} }
  runtime.localStream?.getTracks().forEach((track) => track.stop());
  runtime.audioContext?.close().catch(() => {});
  ui.remoteAudio.srcObject = null;
  runtime.channel = null; runtime.peer = null; runtime.localStream = null; runtime.audioContext = null;
  runtime.analyser = null; runtime.analyserData = null; runtime.analyserFrequencyData = null; runtime.streamingMessage = null;
  runtime.audioLevel = 0; runtime.audioActive = false; runtime.lastAudibleAt = 0;
  runtime.mouthRound = 0;
  runtime.mouthPeak = 0.12;
  runtime.gestureLevel = 0; runtime.gestureTime = 0;
  runtime.responseInProgress = false; runtime.responseFinishedAt = 0; runtime.userSpeaking = false;
}

function setupAudioAnalysis(stream) {
  runtime.audioContext?.close().catch(() => {});
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  runtime.audioContext = new AudioContextClass();
  runtime.audioContext.resume().catch(() => {});
  const source = runtime.audioContext.createMediaStreamSource(stream);
  runtime.analyser = runtime.audioContext.createAnalyser();
  runtime.analyser.fftSize = 1024;
  runtime.analyser.smoothingTimeConstant = 0.12;
  runtime.analyserData = new Float32Array(runtime.analyser.fftSize);
  runtime.analyserFrequencyData = new Uint8Array(runtime.analyser.frequencyBinCount);
  source.connect(runtime.analyser);
}

function setConnectionUi(state) {
  const online = state === "online";
  const connecting = state === "connecting";
  ui.connectionBadge.dataset.state = state;
  ui.connectionBadge.querySelector("strong").textContent = online ? "Online" : connecting ? "Conectando" : "Offline";
  ui.demoButton.disabled = online || connecting;
  ui.connectButton.disabled = connecting;
  ui.voiceConnectButton.disabled = connecting;
  ui.voiceConnectButton.hidden = online;
  ui.connectButton.classList.toggle("is-connected", online);
  ui.connectButton.querySelector("strong").textContent = online ? "Encerrar conversa" : connecting ? "Conectando…" : "Conversar por texto";
  ui.connectButton.querySelector("small").textContent = online ? (runtime.connectionMode === "text" ? "Finalizar sessão de texto e áudio" : "Finalizar sessão de voz") : connecting ? "Preparando canal seguro" : "Digite e ouça as respostas, sem microfone";
  ui.connectButton.querySelector(".connect-icon").textContent = online ? "■" : connecting ? "◌" : "⌨";
  ui.modelSelect.disabled = online || connecting;
  ui.voiceSelect.disabled = online || connecting;
  ui.messageInput.disabled = !online;
  ui.sendButton.disabled = !online || runtime.responseInProgress;
  ui.microphoneButton.disabled = !online || runtime.connectionMode !== "voice";
  ui.speakerButton.disabled = !online;
  ui.messageInput.placeholder = online ? "Digite uma mensagem…" : "Inicie a conversa por texto…";
  ui.microphoneState.textContent = online ? (runtime.connectionMode === "voice" ? "Ligado" : "Não utilizado") : "Desligado";
  ui.microphoneButton.setAttribute("aria-pressed", "false");
}

function sendEvent(event) {
  if (runtime.channel?.readyState !== "open") return false;
  runtime.channel.send(JSON.stringify(event));
  return true;
}

function sendText(text) {
  const cleanText = text.trim();
  if (!cleanText || !runtime.connected || runtime.responseInProgress || runtime.channel?.readyState !== "open") return false;
  if (!sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: cleanText }] } })) return false;
  addMessage("user", cleanText);
  const userTopic = detectTopicFromText(cleanText);
  if (userTopic && userTopic !== runtime.currentKpiKey) {
    updateKpiBackdrop(userTopic);
  }
  if (/\\b(meta|metas|indicador|indicadores|atingir|atingimento|atingiu|kpi|kpis|csat|tmr|fcr|desempenho|resultado|resultados)\\b/i.test(cleanText)) {
    triggerTargetGoalGesture();
  }
  if (!sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } })) {
    showNotice("A mensagem foi enviada, mas a resposta não iniciou. Reconecte e tente novamente.");
    return true;
  }
  runtime.responseInProgress = true;
  ui.sendButton.disabled = true;
  showNotice("");
  ui.remoteAudio.play().catch(() => showNotice("O navegador bloqueou o áudio. Clique em Áudio para ativá-lo."));
  setActivity("thinking");
  return true;
}

function handleRealtimeEvent(messageEvent) {
  let event;
  try { event = JSON.parse(messageEvent.data); } catch { return; }
  switch (event.type) {
    case "input_audio_buffer.speech_started":
      runtime.userSpeaking = true; runtime.audioActive = false; runtime.audioLevel = 0;
      runtime.responseInProgress = false; runtime.responseFinishedAt = 0;
      finishStreamingMessage(); setActivity("listening"); break;
    case "input_audio_buffer.speech_stopped":
      runtime.userSpeaking = false; setActivity("thinking"); break;
    case "conversation.item.input_audio_transcription.completed":
      if (event.transcript?.trim()) {
        const userSpoken = event.transcript.trim();
        addMessage("user", userSpoken);
        const spokenTopic = detectTopicFromText(userSpoken);
        if (spokenTopic && spokenTopic !== runtime.currentKpiKey) {
          updateKpiBackdrop(spokenTopic);
        }

      }
      break;
    case "response.created":
      runtime.responseInProgress = true; runtime.responseFinishedAt = 0;
      setActivity("thinking"); beginStreamingMessage(); break;
    case "response.output_audio.delta":
    case "response.audio.delta":
      break;
    case "response.output_audio_transcript.delta":
    case "response.audio_transcript.delta":
    case "response.output_text.delta":
      appendStreamingText(event.delta || ""); break;
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.done":
    case "response.output_text.done":
      if (!runtime.streamingMessage?.textContent.trim() && (event.transcript || event.text)) appendStreamingText(event.transcript || event.text);
      break;
    case "response.done":
      recoverTranscriptFromResponse(event.response); finishStreamingMessage();
      runtime.responseInProgress = false; runtime.responseFinishedAt = performance.now();
      ui.sendButton.disabled = !runtime.connected;
      if (event.response?.status === "failed") showNotice(event.response.status_details?.error?.message || "Não foi possível gerar a resposta.");
      break;
    case "error":
      console.error("Realtime API:", event); finishStreamingMessage();
      runtime.responseInProgress = false; runtime.audioActive = false; setActivity("idle");
      ui.sendButton.disabled = !runtime.connected;
      showNotice(event.error?.message || "A sessão retornou um erro."); break;
    default: break;
  }
}

function recoverTranscriptFromResponse(response) {
  if (runtime.streamingMessage?.textContent.trim()) return;
  const text = response?.output?.flatMap((item) => item.content || []).map((content) => content.transcript || content.text || "").join(" ").trim();
  if (text) appendStreamingText(text);
}

function beginStreamingMessage() {
  finishStreamingMessage();
  const message = createMessageElement("assistant", "");
  message.classList.add("is-streaming");
  runtime.streamingMessage = message.querySelector("p");
  ui.conversation.append(message);
  scrollConversation();
}

function appendStreamingText(delta) {
  if (!runtime.streamingMessage) beginStreamingMessage();
  runtime.streamingMessage.textContent += delta;
  scrollConversation();

  // Detectar menções a metas, indicadores e resultados para disparar o gesto de meta:
  if (/\\b(meta|metas|indicador|indicadores|atingir|atingimento|atingiu|kpi|kpis|csat|tmr|fcr|desempenho|resultado|resultados)\\b/i.test(delta)) {
    triggerTargetGoalGesture();
  }

  // Alternância dinâmica de gesto ao concluir oração ou frase (pontuação):
  if (/[.!?]\\s*$/.test(delta)) {
    advanceGesturePhrase();
  }

  const streamingTopic = detectTopicFromText(runtime.streamingMessage.textContent);
  if (streamingTopic && streamingTopic !== runtime.currentKpiKey) updateKpiBackdrop(streamingTopic);
}

function normalizeDisplayText(text) {
  if (!text) return "";
  return text
    .replace(/\b(a\s*i\s*c|aici)\b/gi, "AeC")
    .replace(/\bcset\b/gi, "CSAT");
}

function finishStreamingMessage() {
  if (!runtime.streamingMessage) return;
  const wrapper = runtime.streamingMessage.closest(".chat-message");
  wrapper?.classList.remove("is-streaming");
  const rawText = runtime.streamingMessage.textContent;
  if (!rawText.trim()) {
    wrapper?.remove();
  } else {
    runtime.streamingMessage.textContent = normalizeDisplayText(rawText);
  }
  runtime.streamingMessage = null;
}

function createMessageElement(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role === "user" ? "user" : "assistant"}`;
  const avatar = document.createElement("div");
  avatar.className = "mini-avatar";
  avatar.textContent = role === "user" ? "V" : "R";
  const content = document.createElement("div");
  const author = document.createElement("strong");
  author.textContent = role === "user" ? "Você" : "Robbyson";
  const paragraph = document.createElement("p");
  paragraph.textContent = normalizeDisplayText(text);
  content.append(author, paragraph);
  wrapper.append(avatar, content);
  return wrapper;
}

function addMessage(role, text) { ui.conversation.append(createMessageElement(role, text)); scrollConversation(); }
function scrollConversation() { requestAnimationFrame(() => { ui.conversation.scrollTop = ui.conversation.scrollHeight; }); }
function showNotice(message) { ui.appNotice.textContent = message; }

ui.connectButton.addEventListener("click", () => connect("text"));
ui.voiceConnectButton.addEventListener("click", () => connect("voice"));
ui.settingsToggle.addEventListener("click", () => {
  const collapsed = ui.sessionSettings.classList.toggle("is-collapsed");
  ui.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
});
ui.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (sendText(ui.messageInput.value)) {
    ui.messageInput.value = "";
    ui.messageInput.style.height = "auto";
  }
});
ui.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ui.messageForm.requestSubmit(); }
});
ui.messageInput.addEventListener("input", () => {
  ui.messageInput.style.height = "auto";
  ui.messageInput.style.height = `${Math.min(ui.messageInput.scrollHeight, 110)}px`;
});
ui.microphoneButton.addEventListener("click", () => {
  runtime.muted = !runtime.muted;
  runtime.localStream?.getAudioTracks().forEach((track) => { track.enabled = !runtime.muted; });
  ui.microphoneButton.setAttribute("aria-pressed", String(runtime.muted));
  ui.microphoneState.textContent = runtime.muted ? "Mudo" : "Ligado";
  if (runtime.muted) setActivity("idle", "Microfone pausado");
});
ui.speakerButton.addEventListener("click", () => {
  runtime.speakerMuted = !runtime.speakerMuted;
  ui.remoteAudio.muted = runtime.speakerMuted;
  if (!runtime.speakerMuted) ui.remoteAudio.play().then(() => showNotice("")).catch(() => showNotice("Não foi possível reproduzir o áudio neste navegador."));
  ui.speakerButton.setAttribute("aria-pressed", String(runtime.speakerMuted));
  ui.speakerState.textContent = runtime.speakerMuted ? "Mudo" : "Ligado";
});
ui.resetCamera.addEventListener("click", () => { camera.position.copy(defaultCamera); controls.target.set(0, 1.42, 0); controls.update(); });
let demoCycleIndex = 0;
ui.demoButton.addEventListener("click", () => {
  if (runtime.connected) return;
  demoCycleIndex = (demoCycleIndex + 1) % 6;
  runtime.demoUntil = performance.now() + 14000;
  runtime.gestureTime = 0;
  runtime.gesture.elapsed = 999;

  if (demoCycleIndex === 1) {
    updateKpiBackdrop(kpiTopics.tmr);
    advanceGesturePhrase("explain_wide");
  } else if (demoCycleIndex === 2) {
    updateKpiBackdrop(kpiTopics.csat);
    advanceGesturePhrase("emphasis");
  } else if (demoCycleIndex === 3) {
    updateKpiBackdrop(kpiTopics.fcr);
    advanceGesturePhrase("target_goal");
  } else if (demoCycleIndex === 4) {
    updateKpiBackdrop(kpiTopics.absenteismo);
    advanceGesturePhrase("compare");
  } else if (demoCycleIndex === 5) {
    updateKpiBackdrop(kpiTopics.qualidade);
    advanceGesturePhrase("hands_together");
  } else {
    updateKpiBackdrop(kpiTopics.general);
    advanceGesturePhrase("explain_dual");
  }

  const label = runtime.gesture.type === "hands_together" ? "Demonstrando mãos próximas e diálogo" :
                runtime.gesture.type === "target_goal" ? "Demonstrando meta e atingimento de indicadores" :
                runtime.gesture.type === "explain_wide" ? "Demonstrando apresentação aberta com palmas para cima" :
                runtime.gesture.type === "emphasis" ? "Demonstrando ênfase e ponto importante" :
                runtime.gesture.type === "compare" ? "Demonstrando comparação e contraste" :
                "Demonstrando postura didática ativa";
  setActivity("speaking", label);
});
ui.toggleBackdrop?.addEventListener("click", () => {
  kpiSceneryBackdrop.visible = !kpiSceneryBackdrop.visible;
  const isVisible = kpiSceneryBackdrop.visible;
  ui.toggleBackdrop.setAttribute("aria-pressed", String(isVisible));
  ui.toggleBackdrop.textContent = isVisible ? "Painel 3D: Ligado" : "Painel 3D: Pausado";
});

window.addEventListener("beforeunload", cleanupConnection);

if (window.innerWidth <= 640) {
  ui.sessionSettings?.classList.add("is-collapsed");
  ui.settingsToggle?.setAttribute("aria-expanded", "false");
}

updateKpiBackdrop("general");

loadModel();
resizeRenderer();
animate();

