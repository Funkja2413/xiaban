import * as THREE from 'three';

/** 占位配件：刚体、米制、原点在贴合处 */
export function makePlaceholderCap(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'propVisual';
  const mat = new THREE.MeshPhongMaterial({ color: 0x2c3544, shininess: 12 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 16), mat);
  brim.position.y = 0.01;
  brim.castShadow = true;
  group.add(brim);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  dome.position.y = 0.02;
  dome.castShadow = true;
  group.add(dome);
  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.08), mat);
  bill.position.set(0, 0.012, 0.1);
  bill.castShadow = true;
  group.add(bill);
  return group;
}

export function makePlaceholderCup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'propVisual';
  const cup = new THREE.MeshPhongMaterial({ color: 0xf3ead2, shininess: 18 });
  const coffee = new THREE.MeshPhongMaterial({ color: 0x3b2416, shininess: 8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 12), cup);
  body.position.y = 0.04;
  body.castShadow = true;
  group.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 12), coffee);
  lid.position.y = 0.082;
  group.add(lid);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 12, Math.PI), cup);
  handle.rotation.y = Math.PI / 2;
  handle.position.set(0.04, 0.04, 0);
  handle.castShadow = true;
  group.add(handle);
  return group;
}

export function makePlaceholderLaptop(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'propVisual';
  const shell = new THREE.MeshPhongMaterial({ color: 0x3a3f4a, shininess: 26, specular: 0x666666 });
  const screen = new THREE.MeshPhongMaterial({ color: 0x7eb6ff, shininess: 40, emissive: 0x1a3355 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.16), shell);
  base.position.y = 0.006;
  base.castShadow = true;
  group.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.01), shell);
  lid.position.set(0, 0.08, -0.075);
  lid.rotation.x = -0.35;
  lid.castShadow = true;
  group.add(lid);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.11), screen);
  glow.position.set(0, 0.08, -0.069);
  glow.rotation.x = -0.35;
  group.add(glow);
  return group;
}

export const PROP_PRESETS = [
  { id: 'prop-cap', label: '鸭舌帽', anchor: 'head' as const, make: makePlaceholderCap },
  { id: 'prop-cup', label: '咖啡杯', anchor: 'hand' as const, make: makePlaceholderCup },
  { id: 'prop-laptop', label: '笔记本', anchor: 'hand' as const, make: makePlaceholderLaptop },
];
