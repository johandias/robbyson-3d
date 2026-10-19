import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createMotionController } from "./motion/controller.js";
import { ConversationMotion } from "./motion/conversation.js";

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
  mode: "idle", previousMode: "idle", modeStartedAt: 0, demoUntil: 0, demoStartedAt: 0,
  currentKpiKey: "general",
  motion: null, conversationMotion: new ConversationMotion(), motionInput: null, diagnostic: null,
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

const fillLight = new THREE.DirectionalLight(0xf1f7ff, 0.6);
fillLight.position.set(3.5, 4.5, 5.5);
scene.add(fillLight);

const topLight = new THREE.DirectionalLight(0xffffff, 0.35);
topLight.position.set(0, 8, 2);
topLight.castShadow = true;
topLight.shadow.mapSize.set(2048, 2048);
topLight.shadow.bias = -0.00015;
topLight.shadow.normalBias = 0.025;
topLight.shadow.radius = 4;
topLight.shadow.intensity = 0.28;
scene.add(topLight);
const rimLight = new THREE.DirectionalLight(0xa4d8ed, 0.18);
rimLight.position.set(0, 4, -5);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.2, 96),
  new THREE.MeshStandardMaterial({ color: 0x263d4c, roughness: 1, metalness: 0, transparent: true, opacity: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);

for (const [radius, opacity] of [[1.45, 0.28], [2.15, 0.16]]) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.012, radius, 96),
    new THREE.MeshBasicMaterial({ color: 0x54e1f5, transparent: true, opacity, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.012;
  scene.add(ring);
}

const particlesGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(90 * 3);
for (let i = 0; i < particlePositions.length; i += 3) {
  const radius = 1.8 + Math.random() * 2.6;
  const angle = Math.random() * Math.PI * 2;
  particlePositions[i] = Math.cos(angle) * radius;
  particlePositions[i + 1] = 0.15 + Math.random() * 3.7;
  particlePositions[i + 2] = Math.sin(angle) * radius;
}
particlesGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({ color: 0x78dbf0, size: 0.018, transparent: true, opacity: 0.32 }));
scene.add(particles);

// ============================================================================
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
  // This avatar's neutral mesh is an open smile; its MBP target does not close
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
  closedGeometry.dispose();
}

// Coordinates are calibrated in Head-local space for the supplied GLB avatar.
// Deform the existing lips: their UVs, normals and skin material remain intact.
function createFacialMouth(model, head) {
  model.updateMatrixWorld(true);
  const targets = [];
  const local = new THREE.Vector3();
  const moved = new THREE.Vector3();
  const headInverse = head.matrixWorld.clone().invert();
  let affectedVertices = 0;

  model.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const headIndex = mesh.skeleton.bones.indexOf(head);
    if (headIndex < 0) return;
    mesh.skeleton.update();
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const indices = geometry.attributes.skinIndex;
    const weights = geometry.attributes.skinWeight;
    const toHead = headInverse.clone().multiply(mesh.matrixWorld);
    const toMesh = toHead.clone().invert();
    const close = position.clone();
    const open = position.clone();
    const round = position.clone();
    let count = 0;

    for (let index = 0; index < position.count; index += 1) {
      let headWeight = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        if (indices.getComponent(index, slot) === headIndex) headWeight += weights.getComponent(index, slot);
      }
      if (headWeight < 0.65) continue;
      // At load time the model is in bind pose. Use the same space for all targets.
      local.fromBufferAttribute(position, index).applyMatrix4(toHead);
      if (Math.abs(local.x) > 0.073 || local.y < -0.01 || local.y > 0.069 || local.z < 0.135) continue;
      const sides = 1 - THREE.MathUtils.smoothstep(Math.abs(local.x), 0.035, 0.073);
      const front = THREE.MathUtils.smoothstep(local.z, 0.135, 0.173);
      const top = 1 - THREE.MathUtils.smoothstep(local.y, 0.058, 0.069);
      const bottom = THREE.MathUtils.smoothstep(local.y, -0.01, 0.019);
      const influence = sides * front * top * bottom * headWeight;
      if (influence < 0.001) continue;
      const lower = 1 - THREE.MathUtils.smoothstep(local.y, 0.047, 0.054);
      const upper = THREE.MathUtils.smoothstep(local.y, 0.052, 0.058);
      const lipBand = Math.exp(-(((local.y - 0.047) / 0.013) ** 2));

      moved.copy(local);
      moved.y += (0.007 * lower - 0.0016 * upper) * influence * lipBand;
      moved.applyMatrix4(toMesh);
      close.setXYZ(index, moved.x, moved.y, moved.z);

      moved.copy(local);
      moved.y -= 0.009 * lower * influence;
      moved.z -= 0.001 * lower * influence;
      moved.applyMatrix4(toMesh);
      open.setXYZ(index, moved.x, moved.y, moved.z);

      moved.copy(local);
      moved.x *= 1 - 0.105 * influence * lipBand;
      moved.applyMatrix4(toMesh);
      round.setXYZ(index, moved.x, moved.y, moved.z);
      count += 1;
    }
    if (!count) return;
    affectedVertices += count;
    const morphs = geometry.morphAttributes.position || [];
    const offset = morphs.length;
    close.name = "RobbysonLipClose";
    open.name = "RobbysonLipOpen";
    round.name = "RobbysonLipRound";
    geometry.morphAttributes.position = [...morphs, close, open, round];
    mesh.updateMorphTargets();
    targets.push({ mesh, close: offset, open: offset + 1, round: offset + 2 });
  });

  const root = new THREE.Group();
  root.name = "RobbysonFacialMouth";
  head.add(root);

  // A curved skin decal hides the mouth painted into the avatar texture. Its color
  // is sampled from nearby face texels so the edge blends with the character.
  const faceMesh = [];
  model.traverse((object) => { if (object.isSkinnedMesh) faceMesh.push(object); });
  const raycaster = new THREE.Raycaster();
  const headQuaternion = head.getWorldQuaternion(new THREE.Quaternion());
  const inverseHead = head.matrixWorld.clone().invert();
  const sampleSurface = (x, y) => {
    const origin = new THREE.Vector3(x, y, 0.55).applyMatrix4(head.matrixWorld);
    raycaster.set(origin, new THREE.Vector3(0, 0, -1).applyQuaternion(headQuaternion));
    const hit = raycaster.intersectObjects(faceMesh, false)[0];
    return hit ? { point: hit.point.clone().applyMatrix4(inverseHead), uv: hit.uv, material: hit.object.material } : null;
  };
  const cols = 16, rows = 8, patchWidth = 0.084, patchHeight = 0.028;
  const points = [], surfaceHits = [];
  for (let row = 0; row <= rows; row++) {
    points[row] = [];
    surfaceHits[row] = [];
    for (let col = 0; col <= cols; col++) {
      const x = (col / cols - 0.5) * patchWidth;
      const y = 0.036 + row / rows * patchHeight;
      const hit = sampleSurface(x, y);
      surfaceHits[row][col] = hit;
      points[row][col] = hit ? hit.point : new THREE.Vector3(x, y, 0.17);
    }
  }
  const patchPositions = [], patchUvs = [], patchIndices = [];
  points.forEach((line, row) => line.forEach((point, col) => {
    patchPositions.push(point.x, point.y, point.z + 0.00065);
    patchUvs.push(col / cols, row / rows);
    if (row < rows && col < cols) {
      const a = row * (cols + 1) + col, b = a + cols + 1;
      patchIndices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }));

  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = 256; patchCanvas.height = 128;
  const patchContext = patchCanvas.getContext("2d", { willReadFrequently: true });
  const patchPixels = patchContext.createImageData(patchCanvas.width, patchCanvas.height);
  const sourceCanvases = new Map();
  const skinSamples = Array.from({ length: patchCanvas.width }, (_, col) => {
    const gridCol = Math.round(col / (patchCanvas.width - 1) * cols);
    const hit = surfaceHits[0][gridCol];
    const map = hit?.material?.map;
    if (!map?.image || !hit.uv) return [220, 167, 126];
    let source = sourceCanvases.get(map);
    if (!source) {
      source = document.createElement("canvas");
      source.width = map.image.width || 2048; source.height = map.image.height || 2048;
      const ctx = source.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(map.image, 0, 0, source.width, source.height);
      sourceCanvases.set(map, { canvas: source, ctx });
    }
    const { canvas, ctx } = source;
    const sx = THREE.MathUtils.clamp(Math.floor(hit.uv.x * canvas.width), 0, canvas.width - 1);
    const sy = THREE.MathUtils.clamp(Math.floor((1 - hit.uv.y) * canvas.height), 0, canvas.height - 1);
    return Array.from(ctx.getImageData(sx, sy, 1, 1).data).slice(0, 3);
  });
  for (let py = 0; py < patchCanvas.height; py++) for (let px = 0; px < patchCanvas.width; px++) {
    const u = px / (patchCanvas.width - 1), v = py / (patchCanvas.height - 1);
    const edge = Math.sqrt(((u - 0.5) / 0.5) ** 2 + ((v - 0.5) / 0.5) ** 2);
    const alpha = THREE.MathUtils.clamp((1 - edge) * 5, 0, 1);
    const index = (py * patchCanvas.width + px) * 4;
    patchPixels.data[index] = Math.round(skinSamples[px][0] * 0.82);
    patchPixels.data[index + 1] = Math.round(skinSamples[px][1] * 0.82);
    patchPixels.data[index + 2] = Math.round(skinSamples[px][2] * 0.82);
    patchPixels.data[index + 3] = Math.round(alpha * 255);
  }
  patchContext.putImageData(patchPixels, 0, 0);
  const skinTexture = new THREE.CanvasTexture(patchCanvas);
  skinTexture.colorSpace = THREE.SRGBColorSpace;
  const patchGeometry = new THREE.BufferGeometry();
  patchGeometry.setAttribute("position", new THREE.Float32BufferAttribute(patchPositions, 3));
  patchGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(patchUvs, 2));
  patchGeometry.setIndex(patchIndices);
  patchGeometry.computeVertexNormals();
  const skinPatch = new THREE.Mesh(patchGeometry, new THREE.MeshBasicMaterial({
    map: skinTexture, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2,
  }));
  skinPatch.name = "SkinCoverForOriginalMouth";
  skinPatch.renderOrder = 2;
  root.add(skinPatch);

  const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({
    color: 0x321411, roughness: 0.95, side: THREE.DoubleSide, depthTest: false,
    transparent: true, depthWrite: false,
  }));
  cavity.name = "SmallSpeechCavity";
  cavity.scale.set(0.031, 0.0038, 0.0012);
  cavity.position.set(0, 0.0505, (sampleSurface(0, 0.0505)?.point.z || 0.171) + 0.0018);
  cavity.renderOrder = 3;
  root.add(cavity);

  const enamel = new THREE.MeshStandardMaterial({
    color: 0xded5c8, roughness: 0.48, metalness: 0, depthTest: false,
    transparent: true, depthWrite: false,
  });
  const lowerEnamel = enamel.clone();
  lowerEnamel.color.multiplyScalar(0.82);
  const upperTeeth = createDentalArch(enamel, false, sampleSurface);
  const lowerTeeth = createDentalArch(lowerEnamel, true, sampleSurface);
  root.add(upperTeeth, lowerTeeth);

  const tongue = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 8),
    new THREE.MeshStandardMaterial({ color: 0x8c4546, roughness: 0.86 }),
  );
  tongue.name = "Tongue";
  tongue.scale.set(0.022, 0.004, 0.008);
  tongue.position.set(0, 0.047, (sampleSurface(0, 0.047)?.point.z || 0.173) + 0.0017);
  tongue.renderOrder = 4;
  root.add(tongue);

  const mouth = {
    root, upperTeeth, lowerTeeth, tongue, cavity, targets, affectedVertices,
    update(opening, roundness) {
      const amount = THREE.MathUtils.clamp(opening, 0, 0.28);
      const speech = THREE.MathUtils.smoothstep(amount, 0.012, 0.13);
      for (const target of targets) {
        target.mesh.morphTargetInfluences[target.close] = (1 - speech) * 0.94;
        target.mesh.morphTargetInfluences[target.open] = amount;
        target.mesh.morphTargetInfluences[target.round] = roundness * speech * 0.65;
      }
      lowerTeeth.position.y = -amount * 0.010;
      tongue.position.y = 0.047 - amount * 0.006;
      cavity.scale.y = 0.0038 + amount * 0.022;
      root.userData.opening = amount;
    },
  };
  mouth.update(0, 0);
  return mouth;
}

function createDentalArch(material, lower, sampleSurface) {
  const root = new THREE.Group();
  root.name = lower ? "LowerTeeth" : "UpperTeeth";
  // Incisors are broader than lateral teeth; a symmetric pair meets at the center.
  const widths = [0.006, 0.0074, 0.008, 0.008, 0.0074, 0.006];
  const gap = 0.0009;
  let cursor = -(widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)) / 2;
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index] * (lower ? 0.91 : 1);
    const x = cursor + widths[index] / 2;
    cursor += widths[index] + gap;
    const lateral = Math.abs(x) / 0.033;
    const height = (lower ? 0.0058 : 0.0078) * (1 - lateral * 0.13);
    const radius = 0.0012;
    const shape = new THREE.Shape();
    const left = -width / 2;
    const right = width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    shape.moveTo(left + radius, bottom);
    shape.lineTo(right - radius, bottom);
    shape.quadraticCurveTo(right, bottom, right, bottom + radius);
    shape.lineTo(right, top - radius);
    shape.quadraticCurveTo(right, top, right - radius, top);
    shape.lineTo(left + radius, top);
    shape.quadraticCurveTo(left, top, left, top - radius);
    shape.lineTo(left, bottom + radius);
    shape.quadraticCurveTo(left, bottom, left + radius, bottom);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.0008, bevelEnabled: true, bevelThickness: 0.00012,
      bevelSize: 0.0001, bevelSegments: 2, steps: 1, curveSegments: 5,
    });
    const tooth = new THREE.Mesh(geometry, material);
    tooth.name = `${lower ? "Lower" : "Upper"}Tooth${index + 1}`;
    tooth.renderOrder = 3;
    const toothX = x * (lower ? 0.93 : 1);
    const toothY = (lower ? 0.046 : 0.054) + lateral * lateral * 0.00025;
    const surface = sampleSurface(toothX, toothY);
    tooth.position.set(toothX, toothY, (surface?.point.z || 0.171) + 0.0002);
    tooth.rotation.y = -x * 3.0;
    root.add(tooth);
  }
  return root;
}

function setupProceduralMouth() {
  if (runtime.mouthMode !== "procedural" || !runtime.rig.head) return;
  runtime.proceduralMouth = createFacialMouth(runtime.model, runtime.rig.head);
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
          // Keep the floor shadow, but avoid hard self-shadow artifacts on the face and clothing.
          node.receiveShadow = false;
          if (Array.isArray(node.material)) node.material.forEach(prepareMaterial);
          else prepareMaterial(node.material);
        });
        runtime.model = model;
        runtime.modelBaseY = model.position.y;
        mapRig(model);
        setupProceduralMouth();
        runtime.motion = createMotionController(model, runtime.rig);
        if (new URLSearchParams(location.search).has("motion-diagnostics")) {
          import("./motion/diagnostics.js").then(({ installDiagnostics }) => {
            runtime.diagnostic = installDiagnostics({ motion: runtime.motion, scene, camera, controls, ui });
          }).catch(error => showNotice("Diagnóstico indisponível: " + error.message));
        }
        scene.add(model);
        model.updateMatrixWorld(true);
        renderer.render(scene, camera);
        window.__robbysonModel = model;
        window.__robbysonRig = runtime.rig;
        window.__robbysonMouth = runtime.proceduralMouth;
        ui.modelStatus.classList.add("is-hidden");
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
  // The GLB omits metallicFactor (glTF defaults to 1) and exports a specular
  // color factor of 2. Correct both for skin and fabric under direct light.
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

function applyBone(part, x = 0, y = 0, z = 0, speed = 7, delta = 1 / 60) {
  const bone = runtime.rig[part];
  if (!bone) return;
  const rest = runtime.rest.get(bone.uuid);
  if (!rest) return;
  tmpEuler.set(x, y, z, "XYZ");
  tmpQuat.setFromEuler(tmpEuler).multiply(rest.quaternion);
  bone.quaternion.slerp(tmpQuat, 1 - Math.exp(-speed * delta));
}

function animateBody(time, delta) {
  if (!runtime.motion) return;
  let input = runtime.motionInput || { mode: "idle", speaking: false, audible: false, level: 0 };
  let mouthLevel = input.audible ? runtime.audioLevel : 0;
  if (runtime.diagnostic) {
    input = runtime.diagnostic.sample(delta);
    mouthLevel = input.level;
    delta = input.delta;
  } else if (runtime.demoUntil > performance.now()) {
    const elapsed = (performance.now() - runtime.demoStartedAt) / 1000;
    const phrase = elapsed % 4.8 < 4.1;
    const level = phrase ? Math.max(0, Math.sin(elapsed * 13)) * 0.16 : 0;
    input = { mode: "speaking", speaking: true, audible: phrase, level, paused: !phrase };
    mouthLevel = level;
  }
  runtime.motion.update(delta, input);
  animateMouth(delta, mouthLevel);
  runtime.diagnostic?.report();
}

function animateProceduralMouth() {
  runtime.proceduralMouth?.update(runtime.mouthOpen, runtime.mouthRound);
}

function animateMouth(delta, level) {
  // Track relative syllable energy so soft speech is visible and valleys close
  // the lips. No free-running mouth cycle: silence always produces closure.
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
  // A jaw bone is a fallback; combining it with facial morphs doubles the motion.
  if (runtime.mouthMode === "jaw") applyBone("jaw", runtime.mouthOpen * 0.08, 0, 0, 24, delta);
  animateProceduralMouth();
}

function updateAudioLevel(delta) {
  const now = performance.now();
  if (!runtime.analyser || !runtime.analyserData) {
    runtime.audioLevel = THREE.MathUtils.damp(runtime.audioLevel, 0, 18, delta);
    runtime.mouthRound = THREE.MathUtils.damp(runtime.mouthRound, 0, 14, delta);
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

  // The transport/playback bridge consumes this measurement in animate().
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
  runtime.motionInput = runtime.conversationMotion.update(delta, runtime.audioLevel,
    !ui.remoteAudio.paused && ui.remoteAudio.readyState >= 2);
  runtime.audioActive = runtime.motionInput.audible;
  if (runtime.audioActive) runtime.lastAudibleAt = performance.now();
  if (!runtime.diagnostic && runtime.demoUntil <= performance.now() && runtime.mode !== runtime.motionInput.mode) {
    setActivity(runtime.motionInput.mode);
  }
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
  runtime.motion?.forceGesture(null);
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
  runtime.conversationMotion.reset();
  runtime.motion?.reset();
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
  runtime.conversationMotion.event(event);
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
  if (runtime.connected || !runtime.motion) return;
  const demos = [
    ["palms", "Palmas juntas, com aproximação e contato suave"],
    ["stacked", "Uma mão apoiada sobre a outra"],
    ["explain_right", "Explicação e pequeno passo no lugar"],
  ];
  const [gesture, label] = demos[demoCycleIndex++ % demos.length];
  runtime.demoStartedAt = performance.now();
  runtime.demoUntil = runtime.demoStartedAt + 13000;
  const demoStartedAt = runtime.demoStartedAt;
  runtime.motion.forceGesture(gesture);
  if (gesture === "explain_right") runtime.motion.requestStep();
  setActivity("speaking", label);
  window.setTimeout(() => {
    if (runtime.demoStartedAt !== demoStartedAt) return;
    runtime.demoUntil = 0;
    runtime.motion.forceGesture(null);
    setActivity("idle");
  }, 13000);
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

