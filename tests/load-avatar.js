import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Exercise the real skin and bind transforms without a DOM/image decoder.
export async function loadAvatar() {
  const file = await readFile(new URL('../untitled.glb', import.meta.url));
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  delete json.images; delete json.textures; delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const content = Buffer.from(JSON.stringify(json));
  const padded = Math.ceil(content.length / 4) * 4;
  const binary = file.subarray(20 + jsonLength);
  const glb = Buffer.alloc(20 + padded + binary.length, 32);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  content.copy(glb, 20); binary.copy(glb, 20 + padded);
  const { scene: model } = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length), '');
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 3.05 / bounds.getSize(new THREE.Vector3()).y;
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  model.updateMatrixWorld(true);
  const rig = {};
  model.traverse(node => {
    if (!node.isBone) return;
    const name = node.name.replace(/^mixamorig[_:]?/, '');
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    rig[key.replace(/Hand(Thumb|Index)/, '$1')] = node;
  });
  return { model, rig };
}
