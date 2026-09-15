import * as THREE from 'three';
import { PROP_PRESET_FIT } from '../../../src/catalog';

const PRESET = '/models/colleagues/props/presets';

/** 没有合适 CC0 鸭舌帽时的占位 */
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

export type PropPreset = {
  id: string;
  label: string;
  btn: string;
  file?: string;
  fit?: number;
  make?: () => THREE.Group;
};

export const PROP_PRESETS: PropPreset[] = [
  { id: 'prop-cap', label: '鸭舌帽', btn: 'btnPropCap', make: makePlaceholderCap },
  { id: 'prop-cup', label: '咖啡杯', btn: 'btnPropCup', file: `${PRESET}/prop-cup.glb`, fit: PROP_PRESET_FIT['prop-cup'] },
  { id: 'prop-laptop', label: '笔记本', btn: 'btnPropLaptop', file: `${PRESET}/prop-laptop.glb`, fit: PROP_PRESET_FIT['prop-laptop'] },
  { id: 'prop-mic', label: '主持人话筒', btn: 'btnPropMic', file: `${PRESET}/prop-mic.glb`, fit: PROP_PRESET_FIT['prop-mic'] },
  { id: 'prop-lens', label: '放大镜', btn: 'btnPropLens', file: `${PRESET}/prop-lens.glb`, fit: PROP_PRESET_FIT['prop-lens'] },
  { id: 'prop-radio', label: '对讲机', btn: 'btnPropRadio', file: `${PRESET}/prop-radio.glb`, fit: PROP_PRESET_FIT['prop-radio'] },
  { id: 'prop-award', label: '奖状', btn: 'btnPropAward', file: `${PRESET}/prop-award.glb`, fit: PROP_PRESET_FIT['prop-award'] },
  { id: 'prop-paper', label: '报纸', btn: 'btnPropPaper', file: `${PRESET}/prop-paper.glb`, fit: PROP_PRESET_FIT['prop-paper'] },
  { id: 'prop-trophy', label: '奖杯', btn: 'btnPropTrophy', file: `${PRESET}/prop-trophy.glb`, fit: PROP_PRESET_FIT['prop-trophy'] },
  { id: 'prop-papers', label: '一摞报纸', btn: 'btnPropPapers', file: `${PRESET}/prop-papers.glb`, fit: PROP_PRESET_FIT['prop-papers'] },
  { id: 'prop-pack', label: '徒步书包', btn: 'btnPropPack', file: `${PRESET}/prop-pack.glb`, fit: PROP_PRESET_FIT['prop-pack'] },
  { id: 'prop-toilet', label: '马桶', btn: 'btnPropToilet', file: `${PRESET}/prop-toilet.glb`, fit: PROP_PRESET_FIT['prop-toilet'] },
  { id: 'prop-horn', label: '手持大喇叭', btn: 'btnPropHorn', file: `${PRESET}/prop-horn.glb`, fit: PROP_PRESET_FIT['prop-horn'] },
  { id: 'prop-heart', label: '桃心', btn: 'btnPropHeart', file: `${PRESET}/prop-heart.glb`, fit: PROP_PRESET_FIT['prop-heart'] },
  { id: 'prop-clock', label: '闹钟', btn: 'btnPropClock', file: `${PRESET}/prop-clock.glb`, fit: PROP_PRESET_FIT['prop-clock'] },
  { id: 'prop-pot', label: '一口锅', btn: 'btnPropPot', file: `${PRESET}/prop-pot.glb`, fit: PROP_PRESET_FIT['prop-pot'] },
  { id: 'prop-pizza', label: '一张饼', btn: 'btnPropPizza', file: `${PRESET}/prop-pizza.glb`, fit: PROP_PRESET_FIT['prop-pizza'] },
  { id: 'prop-detonator', label: '引爆器按钮', btn: 'btnPropDetonator', file: `${PRESET}/prop-detonator.glb`, fit: PROP_PRESET_FIT['prop-detonator'] },
  { id: 'prop-bell', label: '铃铛', btn: 'btnPropBell', file: `${PRESET}/prop-bell.glb`, fit: PROP_PRESET_FIT['prop-bell'] },
  { id: 'prop-keys', label: '钥匙串', btn: 'btnPropKeys', file: `${PRESET}/prop-keys.glb`, fit: PROP_PRESET_FIT['prop-keys'] },
  { id: 'prop-stop', label: 'STOP 牌', btn: 'btnPropStop', file: `${PRESET}/prop-stop.glb`, fit: PROP_PRESET_FIT['prop-stop'] },
  { id: 'prop-bible', label: '圣经书', btn: 'btnPropBible', file: `${PRESET}/prop-bible.glb`, fit: PROP_PRESET_FIT['prop-bible'] },
  { id: 'prop-swatter', label: '苍蝇拍', btn: 'btnPropSwatter', file: `${PRESET}/prop-swatter.glb`, fit: PROP_PRESET_FIT['prop-swatter'] },
  { id: 'prop-oil', label: '橄榄油', btn: 'btnPropOil', file: `${PRESET}/prop-oil.glb`, fit: PROP_PRESET_FIT['prop-oil'] },
];
