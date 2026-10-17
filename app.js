import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  canvas: $("#viewer"), modelStatus: $("#modelStatus"), modelProgress: $("#modelProgress"), facialRig: $("#facialRig"),
  activityLabel: $("#activityLabel"), activityText: $("#activityText"), presenceOrb: $("#presenceOrb"),
  connectionBadge: $("#connectionBadge"), connectButton: $("#connectButton"), modelSelect: $("#modelSelect"),
  voiceSelect: $("#voiceSelect"), settingsToggle: $("#settingsToggle"), sessionSettings: $("#sessionSettings"),
  conversation: $("#conversation"), messageForm: $("#messageForm"), messageInput: $("#messageInput"), sendButton: $("#sendButton"),
  microphoneButton: $("#microphoneButton"), microphoneState: $("#microphoneState"), speakerButton: $("#speakerButton"),
  speakerState: $("#speakerState"), remoteAudio: $("#remoteAudio"), appNotice: $("#appNotice"),
  resetCamera: $("#resetCamera"), demoButton: $("#demoButton"),
};

const runtime = {
  model: null, rig: {}, rest: new Map(), aimAxes: new Map(), mouthTargets: [], mouthMode: "none", proceduralMouth: null,
  mode: "idle", previousMode: "idle", modeStartedAt: 0, gestureSeed: 0, gestureLevel: 0, demoUntil: 0,
  audioLevel: 0, audioActive: false, lastAudibleAt: 0, responseInProgress: false, responseFinishedAt: 0, userSpeaking: false,
  peer: null, channel: null, localStream: null, audioContext: null, analyser: null, analyserData: null, analyserFrequencyData: null,
  connected: false, connecting: false, muted: false, speakerMuted: false, streamingMessage: null,
  mouthOpen: 0, mouthRound: 0, modelBaseY: 0,
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07111c, 0.065);

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
const defaultCamera = new THREE.Vector3(0, 1.72, 6.4);
camera.position.copy(defaultCamera);

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
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

scene.add(new THREE.HemisphereLight(0xe3f3ff, 0x151922, 1.85));
const keyLight = new THREE.DirectionalLight(0xfff7ef, 2.75);
keyLight.position.set(3.5, 6, 4.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const rimLight = new THREE.SpotLight(0x7ed9eb, 7.5, 12, Math.PI / 5, 0.7, 1.2);
rimLight.position.set(-4, 4, -2);
rimLight.target.position.set(0, 1.4, 0);
scene.add(rimLight, rimLight.target);
const fillLight = new THREE.PointLight(0xc5baff, 2.4, 8);
fillLight.position.set(3, 1.7, -2.5);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4.2, 96),
  new THREE.MeshStandardMaterial({ color: 0x0a1722, roughness: 0.82, metalness: 0.24, transparent: true, opacity: 0.9 }),
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

const clock = new THREE.Clock();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const aimParentQuaternion = new THREE.Quaternion();
const aimDeltaQuaternion = new THREE.Quaternion();
const aimTargetQuaternion = new THREE.Quaternion();
const aimDirection = new THREE.Vector3();
const armPose = {
  leftUpper: new THREE.Vector3(), leftLower: new THREE.Vector3(),
  rightUpper: new THREE.Vector3(), rightLower: new THREE.Vector3(),
};
const armDirections = {
  idleLeftUpper: new THREE.Vector3(0.37, -0.92, 0.12).normalize(),
  idleLeftLower: new THREE.Vector3(0.22, -0.96, 0.18).normalize(),
  idleRightUpper: new THREE.Vector3(-0.37, -0.92, 0.12).normalize(),
  idleRightLower: new THREE.Vector3(-0.22, -0.96, 0.18).normalize(),
  talkLeftUpper: new THREE.Vector3(0.28, -0.84, 0.46).normalize(),
  talkLeftLower: new THREE.Vector3(-0.08, 0.28, 0.96).normalize(),
  talkRightUpper: new THREE.Vector3(-0.28, -0.84, 0.46).normalize(),
  talkRightLower: new THREE.Vector3(0.08, 0.28, 0.96).normalize(),
  openLeftUpper: new THREE.Vector3(0.48, -0.74, 0.47).normalize(),
  openLeftLower: new THREE.Vector3(0.22, 0.18, 0.96).normalize(),
  openRightUpper: new THREE.Vector3(-0.48, -0.74, 0.47).normalize(),
  openRightLower: new THREE.Vector3(-0.22, 0.18, 0.96).normalize(),
  thinkRightUpper: new THREE.Vector3(-0.1, -0.68, 0.72).normalize(),
  thinkRightLower: new THREE.Vector3(0.1, 0.95, 0.3).normalize(),
  waveRightUpper: new THREE.Vector3(-0.3, -0.35, 0.89).normalize(),
  waveRightLower: new THREE.Vector3(0.08, 0.97, 0.25).normalize(),
};

const boneAliases = {
  hips: ["hips"], spine: ["spine"], spine1: ["spine1"], spine2: ["spine2", "chest"], neck: ["neck"], head: ["head"],
  jaw: ["jaw", "lowerjaw", "chin", "queixo", "mandible", "mandibula", "maxilar", "maxilarinferior"],
  leftShoulder: ["leftshoulder"], leftArm: ["leftarm", "leftupperarm"], leftForeArm: ["leftforearm", "leftlowerarm"], leftHand: ["lefthand"],
  rightShoulder: ["rightshoulder"], rightArm: ["rightarm", "rightupperarm"], rightForeArm: ["rightforearm", "rightlowerarm"], rightHand: ["righthand"],
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
  const mouthPattern = /(jawopen|mouthopen|mouthclose|viseme|phoneme|lip|mouthsmile)/i;
  model.traverse((node) => {
    if (!node.isMesh || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
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

// Coordinates are calibrated in Head-local space for the supplied T-Pose.fbx.
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

  // A curved skin decal hides the mouth painted into the FBX texture. Its color
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

function loadModel() {
  const loader = new FBXLoader();
  loader.load(
    "./T-Pose.fbx",
    (model) => {
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 3.05 / Math.max(size.y, 0.01);
      model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      model.scale.setScalar(scale);
      model.traverse((node) => {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
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
      window.__robbysonMouth = runtime.proceduralMouth;
      ui.modelStatus.classList.add("is-hidden");
    },
    (progress) => {
      if (!progress.total) return;
      const percent = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
      ui.modelProgress.textContent = `Carregando modelo 3D… ${percent}%`;
    },
    (error) => {
      console.error("Falha ao carregar FBX:", error);
      ui.modelStatus.querySelector("strong").textContent = "Modelo indisponível";
      ui.modelProgress.textContent = "Confirme se T-Pose.fbx está na pasta do projeto.";
      ui.modelStatus.querySelector(".loader").style.display = "none";
    },
  );
}

function prepareMaterial(material) {
  if (!material) return;
  material.needsUpdate = true;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
}

function applyBone(part, x = 0, y = 0, z = 0, speed = 7, delta = 1 / 60) {
  const bone = runtime.rig[part];
  if (!bone) return;
  const rest = runtime.rest.get(bone.uuid);
  tmpEuler.set(x, y, z, "XYZ");
  tmpQuat.setFromEuler(tmpEuler).multiply(rest.quaternion);
  bone.quaternion.slerp(tmpQuat, 1 - Math.exp(-speed * delta));
}

function aimBone(part, childPart, worldDirection, speed = 7, delta = 1 / 60) {
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
  bone.quaternion.slerp(aimTargetQuaternion, 1 - Math.exp(-speed * delta));
}

function animateBody(time, delta) {
  if (!runtime.model) return;
  const demoActive = runtime.demoUntil > performance.now();
  const mode = demoActive ? "speaking" : runtime.mode;
  const speaking = demoActive || runtime.audioActive;
  const listening = mode === "listening";
  const thinking = mode === "thinking";
  const greeting = mode === "greeting";
  const breath = Math.sin(time * 1.45);
  const energy = speaking ? Math.max(runtime.audioLevel, demoActive ? 0.28 + Math.sin(time * 12) * 0.12 : 0) : 0;
  const gestureTarget = speaking ? THREE.MathUtils.clamp(demoActive ? 0.52 : energy * 1.8, 0, 0.7) : 0;
  runtime.gestureLevel = THREE.MathUtils.damp(runtime.gestureLevel, gestureTarget, speaking ? 6 : 12, delta);
  const phrase = (time * 0.7 + runtime.gestureSeed) % 3;
  const gestureA = smoothPulse(phrase, 0.08, 0.82) * runtime.gestureLevel;
  const gestureB = smoothPulse(phrase, 1.08, 1.82) * runtime.gestureLevel;
  const gestureC = smoothPulse(phrase, 2.15, 2.72) * runtime.gestureLevel;
  const welcomeTime = greeting ? (performance.now() - runtime.modeStartedAt) / 1000 : 99;
  const wave = greeting && welcomeTime < 3.6 ? Math.sin(welcomeTime * 8.5) : 0;
  const greetingWeight = greeting ? Math.max(0, 1 - Math.max(0, welcomeTime - 3.2) / 0.5) : 0;

  runtime.model.position.y += ((runtime.modelBaseY + breath * 0.006 + (listening ? -0.012 : 0)) - runtime.model.position.y) * Math.min(1, delta * 4);
  runtime.model.rotation.y += ((speaking ? Math.sin(time * 0.7) * 0.025 : 0) - runtime.model.rotation.y) * Math.min(1, delta * 3);
  const bodyLean = listening ? 0.055 : thinking ? -0.025 : speaking ? Math.sin(time * 0.8) * 0.018 : 0;
  applyBone("hips", 0, Math.sin(time * 0.55) * 0.012, 0, 4, delta);
  applyBone("spine", bodyLean * 0.35, Math.sin(time * 0.43) * 0.014, breath * 0.008, 5, delta);
  applyBone("spine1", bodyLean * 0.45, Math.sin(time * 0.48) * 0.017, -breath * 0.006, 5, delta);
  applyBone("spine2", bodyLean * 0.4, speaking ? Math.sin(time * 1.3) * 0.022 : 0, 0, 6, delta);
  applyBone("neck", listening ? 0.07 : speaking ? Math.sin(time * 1.7) * 0.025 : 0, listening ? -0.025 : 0, 0, 7, delta);
  applyBone("head", listening ? 0.08 : (speaking ? Math.sin(time * 2.1) * 0.035 * (0.4 + energy) : 0), speaking ? Math.sin(time * 0.92) * 0.035 : thinking ? -0.07 : 0, speaking ? Math.sin(time * 1.4) * 0.016 : 0, 8, delta);

  let leftHandX = 0;
  let rightHandX = 0;
  armPose.leftUpper.copy(armDirections.idleLeftUpper);
  armPose.leftLower.copy(armDirections.idleLeftLower);
  armPose.rightUpper.copy(armDirections.idleRightUpper);
  armPose.rightLower.copy(armDirections.idleRightLower);
  if (listening) {
    armPose.rightUpper.lerp(armDirections.talkRightUpper, 0.18);
    armPose.rightLower.lerp(armDirections.talkRightLower, 0.15);
  } else if (thinking) {
    armPose.rightUpper.lerp(armDirections.thinkRightUpper, 0.82);
    armPose.rightLower.lerp(armDirections.thinkRightLower, 0.88);
    rightHandX = 0.15;
  } else if (speaking) {
    armPose.rightUpper.lerp(armDirections.talkRightUpper, 0.66 * gestureA);
    armPose.rightLower.lerp(armDirections.talkRightLower, 0.76 * gestureA);
    armPose.leftUpper.lerp(armDirections.talkLeftUpper, 0.62 * gestureB);
    armPose.leftLower.lerp(armDirections.talkLeftLower, 0.72 * gestureB);
    armPose.rightUpper.lerp(armDirections.openRightUpper, 0.42 * gestureC);
    armPose.rightLower.lerp(armDirections.openRightLower, 0.52 * gestureC);
    armPose.leftUpper.lerp(armDirections.openLeftUpper, 0.42 * gestureC);
    armPose.leftLower.lerp(armDirections.openLeftLower, 0.52 * gestureC);
    rightHandX = (0.05 + Math.sin(time * 3.1) * 0.07) * (gestureA + 0.35 * gestureC);
    leftHandX = (-0.04 - Math.sin(time * 2.4) * 0.06) * (gestureB + 0.35 * gestureC);
  } else if (greeting) {
    armPose.rightUpper.lerp(armDirections.waveRightUpper, greetingWeight);
    armPose.rightLower.lerp(armDirections.waveRightLower, greetingWeight);
    rightHandX = wave * 0.35 * greetingWeight;
  }
  armPose.leftUpper.normalize();
  armPose.leftLower.normalize();
  armPose.rightUpper.normalize();
  armPose.rightLower.normalize();
  applyBone("leftShoulder", 0, 0, speaking ? -0.022 * gestureB : 0, 8, delta);
  applyBone("rightShoulder", 0, 0, speaking ? 0.026 * (gestureA + gestureC) : 0, 8, delta);
  aimBone("leftArm", "leftForeArm", armPose.leftUpper, 7, delta);
  aimBone("rightArm", "rightForeArm", armPose.rightUpper, 7, delta);
  aimBone("leftForeArm", "leftHand", armPose.leftLower, 8, delta);
  aimBone("rightForeArm", "rightHand", armPose.rightLower, 8, delta);
  applyBone("leftHand", leftHandX, speaking ? Math.sin(time * 1.8) * 0.07 * gestureB : 0, 0, 8, delta);
  applyBone("rightHand", rightHandX, speaking ? Math.sin(time * 2.2) * 0.09 * (gestureA + gestureC) : 0, wave * 0.12, 8, delta);
  animateMouth(time, delta, speaking ? energy : 0);
}

function smoothPulse(value, start, end) {
  if (value <= start || value >= end) return 0;
  return Math.sin(((value - start) / (end - start)) * Math.PI) ** 2;
}

function animateProceduralMouth() {
  runtime.proceduralMouth?.update(runtime.mouthOpen, runtime.mouthRound);
}

function animateMouth(time, delta, level) {
  // Follow the playback envelope directly; a free-running sine caused false syllables.
  const syllable = level > 0.012 ? THREE.MathUtils.clamp(level * 1.15, 0, 0.65) : 0;
  runtime.mouthOpen = THREE.MathUtils.damp(runtime.mouthOpen, syllable, syllable > runtime.mouthOpen ? 48 : 50, delta);
  for (const target of runtime.mouthTargets) {
    const isSmile = target.name.includes("smile");
    const isClose = target.name.includes("close");
    const isViseme = target.name.includes("viseme") || target.name.includes("phoneme");
    const phonemeVariation = isViseme ? 0.72 + 0.28 * Math.sin(time * 12.5 + target.index * 1.7) : 1;
    const variation = isSmile ? runtime.mouthOpen * 0.1 : isClose ? 0 : runtime.mouthOpen * phonemeVariation;
    target.mesh.morphTargetInfluences[target.index] += (variation - target.mesh.morphTargetInfluences[target.index]) * Math.min(1, delta * 24);
  }
  if (runtime.rig.jaw) applyBone("jaw", runtime.mouthOpen * 0.14, 0, 0, 24, delta);
  animateProceduralMouth(time);
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
  const normalized = THREE.MathUtils.clamp((rms - 0.012) * 8, 0, 1);
  runtime.audioLevel = THREE.MathUtils.damp(runtime.audioLevel, normalized, normalized > runtime.audioLevel ? 36 : 45, delta);
  if (runtime.analyserFrequencyData) {
    runtime.analyser.getByteFrequencyData(runtime.analyserFrequencyData);
    let low = 0;
    let middle = 0;
    for (let index = 2; index < 8; index += 1) low += runtime.analyserFrequencyData[index];
    for (let index = 8; index < 24; index += 1) middle += runtime.analyserFrequencyData[index];
    low /= 6;
    middle /= 16;
    const spectralRatio = low / Math.max(1, low + middle);
    const roundTarget = normalized > 0.018 ? THREE.MathUtils.clamp((spectralRatio - 0.42) * 2.8, 0, 1) : 0;
    runtime.mouthRound = THREE.MathUtils.damp(runtime.mouthRound, roundTarget, 14, delta);
  }

  if (normalized > 0.018 && !runtime.userSpeaking) {
    runtime.lastAudibleAt = now;
    if (!runtime.audioActive) {
      runtime.audioActive = true;
      runtime.gestureSeed = Math.random() * 3;
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
    if (mode === "speaking") runtime.gestureSeed = Math.random() * 3;
  }
  const labels = {
    idle: [runtime.connected ? "Conectado" : "Em repouso", runtime.connected ? "Pronto para ouvir" : "Pronto para conversar"],
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
  camera.aspect = rect.width / rect.height;
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
  particles.rotation.y = time * 0.025;
  controls.update();
  renderer.render(scene, camera);
}

async function connect() {
  if (runtime.connected) { disconnect(); return; }
  if (runtime.connecting) return;
  runtime.connecting = true;
  setConnectionUi("connecting");
  showNotice("");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não oferece acesso ao microfone.");
    const tokenResponse = await fetch("/api/realtime/token", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ui.modelSelect.value, voice: ui.voiceSelect.value }),
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
      const [stream] = event.streams;
      if (!stream) return;
      ui.remoteAudio.srcObject = stream;
      ui.remoteAudio.play().catch(() => {});
      setupAudioAnalysis(stream);
    };
    runtime.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    for (const track of runtime.localStream.getTracks()) peer.addTrack(track, runtime.localStream);

    const channel = peer.createDataChannel("oai-events");
    runtime.channel = channel;
    channel.addEventListener("message", handleRealtimeEvent);
    channel.addEventListener("open", () => {
      runtime.connected = true;
      runtime.connecting = false;
      setConnectionUi("online");
      setActivity("greeting");
      sendEvent({ type: "response.create", response: { instructions: "Cumprimente o colaborador em português do Brasil de forma breve, calorosa e confiante. Diga seu nome e pergunte como pode ajudar." } });
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
    setConnectionUi("offline");
    setActivity("idle");
    showNotice(error.message || "Falha ao conectar.");
  }
}

function disconnect(message = "") {
  cleanupConnection();
  runtime.connected = false;
  runtime.connecting = false;
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
  runtime.analyser.fftSize = 256;
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
  ui.connectButton.disabled = connecting;
  ui.connectButton.classList.toggle("is-connected", online);
  ui.connectButton.querySelector("strong").textContent = online ? "Encerrar conversa" : connecting ? "Conectando…" : "Iniciar conversa";
  ui.connectButton.querySelector("small").textContent = online ? "Finalizar sessão de voz" : connecting ? "Preparando canal seguro" : "Ativar microfone e conectar";
  ui.connectButton.querySelector(".connect-icon").textContent = online ? "■" : connecting ? "◌" : "◉";
  ui.modelSelect.disabled = online || connecting;
  ui.voiceSelect.disabled = online || connecting;
  ui.messageInput.disabled = !online;
  ui.sendButton.disabled = !online;
  ui.microphoneButton.disabled = !online;
  ui.speakerButton.disabled = !online;
  ui.messageInput.placeholder = online ? "Digite uma mensagem…" : "Conecte para conversar…";
  ui.microphoneState.textContent = online ? "Ligado" : "Desligado";
  ui.microphoneButton.setAttribute("aria-pressed", "false");
}

function sendEvent(event) {
  if (runtime.channel?.readyState !== "open") return false;
  runtime.channel.send(JSON.stringify(event));
  return true;
}

function sendText(text) {
  const cleanText = text.trim();
  if (!cleanText || !runtime.connected) return;
  addMessage("user", cleanText);
  sendEvent({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: cleanText }] } });
  sendEvent({ type: "response.create", response: { output_modalities: ["audio"] } });
  setActivity("thinking");
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
      if (event.transcript?.trim()) addMessage("user", event.transcript.trim()); break;
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
      finishStreamingMessage(); break;
    case "response.done":
      recoverTranscriptFromResponse(event.response); finishStreamingMessage();
      runtime.responseInProgress = false; runtime.responseFinishedAt = performance.now(); break;
    case "error":
      console.error("Realtime API:", event); finishStreamingMessage();
      runtime.responseInProgress = false; runtime.audioActive = false; setActivity("idle");
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
}

function finishStreamingMessage() {
  if (!runtime.streamingMessage) return;
  const wrapper = runtime.streamingMessage.closest(".chat-message");
  wrapper?.classList.remove("is-streaming");
  if (!runtime.streamingMessage.textContent.trim()) wrapper?.remove();
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
  paragraph.textContent = text;
  content.append(author, paragraph);
  wrapper.append(avatar, content);
  return wrapper;
}

function addMessage(role, text) { ui.conversation.append(createMessageElement(role, text)); scrollConversation(); }
function scrollConversation() { requestAnimationFrame(() => { ui.conversation.scrollTop = ui.conversation.scrollHeight; }); }
function showNotice(message) { ui.appNotice.textContent = message; }

ui.connectButton.addEventListener("click", connect);
ui.settingsToggle.addEventListener("click", () => {
  const collapsed = ui.sessionSettings.classList.toggle("is-collapsed");
  ui.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
});
ui.messageForm.addEventListener("submit", (event) => {
  event.preventDefault(); sendText(ui.messageInput.value); ui.messageInput.value = ""; ui.messageInput.style.height = "auto";
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
  ui.speakerButton.setAttribute("aria-pressed", String(runtime.speakerMuted));
  ui.speakerState.textContent = runtime.speakerMuted ? "Mudo" : "Ligado";
});
ui.resetCamera.addEventListener("click", () => { camera.position.copy(defaultCamera); controls.target.set(0, 1.42, 0); controls.update(); });
ui.demoButton.addEventListener("click", () => {
  runtime.demoUntil = performance.now() + 8500;
  runtime.gestureSeed = Math.random() * 3;
  setActivity("speaking", "Demonstrando expressão corporal");
  window.setTimeout(() => {
    if (runtime.demoUntil <= performance.now() && !runtime.audioActive) setActivity(runtime.responseInProgress ? "thinking" : "idle");
  }, 8600);
});
window.addEventListener("beforeunload", cleanupConnection);

loadModel();
resizeRenderer();
animate();
