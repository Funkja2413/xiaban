# Kenney 同事角色编辑器 — 实现规格

给后续对话用：在本仓库里做一份**离线资产工具**，基于现有 Kenney CC0 `characterMedium`，用「换 UV 贴图 + 往头骨上挂发型网格」快速产出多种同事。做完后把变体清单交给游戏加载器。

不要做成局内捏人，不要改拓扑当角色编辑器。

---

## 1. 背景（读完再动手）

游戏：《我要下班！》，仓库根目录即本项目。竖屏、WebGPU、约 80 个同事。同事是 **InstancedMesh**，不是 80 套独立 SkinnedMesh。

当前角色管线：

| 项 | 现状 |
|---|---|
| 身体 | `public/models/kenney/characterMedium.fbx`（**一具中性网格**） |
| 骨骼动画 | 同目录 `idle.fbx` / `run.fbx` |
| 皮肤 | `humanMaleA.png`、`humanFemaleA.png`（256×256，画在同一套 UV 上） |
| 加载 | `src/game/humanoid.ts` → `loadHumanoidKit()` |
| 玩家 | `SkeletonUtils.clone` + `AnimationMixer` 播 idle/run |
| 同事 | idle 烤成静网格 + run 循环烤 4 帧，按性别两套 InstancedMesh 轮播 |
| 身高 | 规范化到 1.72m，脚贴地 |

Kenney 包名：Animated Characters 3（现名 Animated Characters Retro），CC0。所谓「女同事」目前只是换了女贴图，身体还是同一具。

已否决：局内程序化捏人、Ready Player Me、80 套独特蒙皮、把长发焊进身体网格导致每发型分叉一份图集。

---

## 2. 目标 / 非目标

### 要做

1. 独立进程 `http://localhost:5174/`（`./dev.sh editor`），不进战斗 HUD，**不进 `npm run build`**。
2. 加载 Kenney `characterMedium` + idle/run，轨道相机预览，可播 idle / run。
3. **上传 PNG UV 图集**，立刻贴到角色上预览（可同时对照官方皮）。
4. **加载发型模型**（GLB/GLTF 优先，FBX 次之），挂到 `Head` 骨上，可调位移/旋转/缩放。
5. 保存「同事变体」：身体贴图 + 发型 + 变换。导出文件落到 `public/models/kenney/` 或 `public/models/colleagues/`。
6. 变体数量按游戏预算设计：**贴图 4～8 张、发型 2～3 个**，不是 80 套独特网格。

### 不要做

- 改 Kenney 骨骼、重拓扑、morph 体型、布料、捏五官滑条。
- 把头发画进身体图集的新岛（除非仍占用现有头发岛且轮廓不变）。
- 在 `src/game/game.ts` 里塞编辑器 UI。
- Mixamo 角色网格（授权不是 CC0）；动画若要用须单独说明。
- 第一期就做「Blender 雕女体」。女体网格以后可以以**同一套骨名 + 同一套 UV** 替换 `characterMedium`，编辑器接口保持不变。

---

## 3. 产品交互

建议三栏，桌面横屏即可（编辑器不要求竖屏）。

```
┌─────────────┬──────────────────┬──────────────────┐
│ 资源        │ 3D 预览          │ 变体             │
│ 官方皮肤    │ Kenney 人 + 发型 │ 名称 / 性别标签  │
│ 上传 PNG    │ 播 idle / run    │ 保存 / 导出清单  │
│ 发型 GLB    │ 重置相机         │ 缩略图（可选）   │
│ 岛遮罩开关  │ 发型 gizmo       │                  │
└─────────────┴──────────────────┴──────────────────┘
```

必须有的操作：

- 拖入或选择 PNG → `TextureLoader` 应用到 SkinnedMesh。`flipY = true`，`colorSpace = SRGBColorSpace`（与 `humanoid.ts` 一致）。
- 并排或切换「官方皮 / 我的皮」，避免 UV 对不上却看不出来。
- 可选：半透明 **UV 岛参考图**叠在 2D 贴图预览上（见 §6）。
- 加载发型 → 挂 `Head`；数字输入或 TransformControls 调 `position / rotation / scale`。
- 隐藏 Kenney 自带头顶短发体积：**不能**改拓扑。第一期用「发型网格盖住」或材质上把头岛染成肤色/头皮；不要删顶点。
- 保存变体写入 JSON；「打包下载」把 JSON + 用到的 PNG/GLB 路径列清楚（文件本身已在 `public/` 则只写相对路径）。

---

## 4. 仓库里怎么放

```
tools/editor/index.html              # 编辑器入口（独立 Vite，勿改游戏 index.html）
tools/editor/src/                    # 预览 / 皮肤 / 发型 / 变体
tools/editor/library/quaternius/     # 预览用发型库，不进发布包
src/catalog.ts                       # 游戏只读 catalog
public/models/kenney/                # 现有 CC0 身体与官方皮，只读
public/models/colleagues/
  skins/                             # 保存进游戏的 PNG
  hairs/                             # 保存进游戏的发型 GLB
  catalog.json                       # 变体清单（游戏读取；发布只打这里引用的文件）
docs/character-editor.md             # 本文件
```

编辑器：`vite.editor.config.ts`，端口 5174。游戏：`vite.config.ts`，端口 5173，`base: './'`。不要和游戏抢 `src/main.ts`。

依赖：继续用项目里的 `three` 0.185。编辑器可用 `WebGLRenderer`（无需 WebGPU），避免和游戏渲染器纠缠。

---

## 5. 运行时怎么挂发型

Kenney 身体是**一块** `SkinnedMesh`。头发不要焊进去。

绑定约定：

1. 找到骨名为 `Head` 的 `THREE.Bone`（该 FBX 里还有 `Neck`、`UpperChest`、`Hips` 等 Mixamo 风格名字）。
2. 发型作为 `Head` 的 child。世界尺度已由身体 `normalizeToGround` 拉到 1.72m，发型在 **Head 局部空间**调。
3. 发型第一期按**刚体配件**：不需要自己的骨骼。若 GLB 自带骨骼，忽略或只留网格。
4. 默认：先把发型包围盒底中心对齐到 Head 原点附近，再让用户微移。提供「重置变换」。
5. 导出到游戏时：同事是烤网格。烘焙身体帧时，发型要 **一起 bake 进那一帧的几何**，或单独一套 hair InstancedMesh 用同一套 instanceMatrix（身体矩阵 × Head 局部矩阵）。第一期编辑器只需把「Head 局部变换」写进 catalog；游戏合批可以后做，但 catalog 字段必须预留（见 §7）。

作者制作发型时的约束（写进编辑器侧栏）：

- 单位米；角色总高约 1.72。
- 原点放在头皮/发髻贴头处，+Y 向上，+Z 向前（与 three/Kenney 预览不一致时，在编辑器里用固定欧拉预旋转，并写入 catalog 的 `hair.preRotation`）。
- 三角面尽量 < 800，无透明发片更好（人群远看）。
- CC0 或自有版权；Kenney 头已有短发壳，长发/马尾必须盖住该壳。

---

## 6. UV 贴图约定

`characterMedium` 的 UV 是 Kenney 官方图集布局。上传图必须是 **正方形 PNG**（官方 Retro 皮 256×256；Survivors 类岛图常见 1024×1024）。非正方形要拒绝或居中警告。

游戏加载：`flipY = true`。编辑器必须同样，否则预览对、进游戏反。

岛的大致分区（以 Kenney 图集为准，像素比例不随分辨率变）：

| 区域 | 大致位置 | 换皮时改什么 |
|---|---|---|
| 头/脸/短发壳 | 左上大岛 | 肤色、五官、**贴图发型**（轮廓仍是短发壳） |
| 上衣 + 左右臂/袖 | 左下 | 衬衫颜色、袖长观感（仍是同一身形） |
| 鞋 | 中右两个圆/块 | 鞋色 |
| 裤 | 右下矩形 | 裤色 |
| 边角色块 | 右上小方块 | 配件/头皮；对不齐时不要当脸来画 |

换皮编辑器**只改这些岛的颜色/图案**，不要重排岛。用 AI 生成的图集只能当草稿，必须在 3D 预览里看脸和袖子是否错位。

官方参考皮（务必做「加载官方」按钮）：

- `public/models/kenney/humanMaleA.png`
- `public/models/kenney/humanFemaleA.png`

---

## 7. 变体数据格式

`public/models/colleagues/catalog.json`：

```json
{
  "version": 1,
  "base": {
    "mesh": "/models/kenney/characterMedium.fbx",
    "idle": "/models/kenney/idle.fbx",
    "run": "/models/kenney/run.fbx",
    "height": 1.72
  },
  "hairs": [
    {
      "id": "bob-short",
      "file": "/models/colleagues/hairs/bob-short.glb",
      "preRotation": [0, 0, 0]
    }
  ],
  "skins": [
    {
      "id": "office-white-navy",
      "file": "/models/colleagues/skins/office-white-navy.png",
      "flipY": true
    }
  ],
  "variants": [
    {
      "id": "colleague-f-01",
      "label": "女同事·白衫",
      "gender": "female",
      "skin": "office-white-navy",
      "hair": "bob-short",
      "hairTransform": {
        "position": [0, 0.02, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    }
  ]
}
```

`variants[].id` 必须等于 `src/roster.ts` 里的规划槽位（`player` / `colleague-a-f` / `colleague-a-m` / `heavy` / `interceptor`）。编辑器按槽保存形象，不另造游离变体。规划扩容：改 `ROSTER` 后编辑器刷新。

`hairTransform` 是 Head 局部空间，欧拉 XYZ，单位弧度。

预算：`skins` ≤ 8，`hairs` ≤ 3。同事合批大约是 `(身体姿态帧) × (用到的皮肤数)`。

---

## 8. 和现有游戏代码的衔接

`loadHumanoidKit` 读 `catalog.json`，按变体性别各取一张皮（没有 catalog 则官方男女皮）。发型合批进人群仍是后续：每个 hair id 一套 InstancedMesh，或烘焙进走帧。玩家继续 clone + mixer。

动画坑（已在 `humanoid.ts` 修过，编辑器要抄）：

- `run.fbx` 的 `animations[0]` 经常是 1 帧 `Root|0.Targeting Pose`，真正循环是 `Root|Run`。
- 选 clip：名字包含 idle/run 且 `duration > 0.2`，排除 targeting/pose。

---

## 9. 实现顺序（另一场对话按此打勾）

1. Vite 多页：`editor.html` + `src/editor/main.ts`，空场景能转相机。
2. 复用或抽出 `humanoid.ts` 的 FBX 加载、`pickClip`、`normalizeToGround`、`flipY`。**不要复制一份过时的 animations[0]。** 编辑器里直接播 mixer，不必 bake 走帧。
3. 官方两张皮切换 + 上传 PNG 预览。
4. 2D 贴图查看器（一张图 + 可选岛线框）。
5. 加载 GLB 发型，attach `Head`，TransformControls。
6. 读写 `catalog.json`；列出变体；保存当前「皮+发型+变换」。
7. 超预算警告（皮肤>8、发型>3）。
8. README 或本文件末尾补一句：如何打开编辑器。游戏主流程保持 `./dev.sh` → `/`。

---

## 10. 验收

- 打开 `http://localhost:5174/`，看到 Kenney 人，idle 在动，不是 T-pose。
- 切 `humanFemaleA.png`，脸和衣服在正确位置。
- 上传一张自己的正方形 PNG，3D 上立刻换皮；`flipY` 与游戏一致。
- 加载一个简单发型 GLB，跟着点头（播 idle 时头发贴头）。
- 保存两条变体到 `catalog.json`，刷新编辑器能还原。
- 游戏 `/` 仍能开局，不因编辑器入口而坏。
- 不新增局内捏人 UI，不改相机高度（游戏相机保持现有 17.5 / FOV 55）。

---

## 11. 给资产作者的一页纸

身体：只用 Kenney `characterMedium`，CC0。换同事外观 = 画图集 PNG + 可选发型 GLB。

画皮：从 `humanMaleA.png` 复制一份改岛，不要重排 UV。

做发型：独立网格，原点在头皮，绑到 `Head`，盖住 Kenney 短发壳。

产出：PNG 进 `public/models/colleagues/skins/`，GLB 进 `hairs/`，用编辑器写进 `catalog.json`。

女体以后若要真轮廓：Blender 里改 `characterMedium` 比例，**骨名与 UV 岛保持不动**，替换 mesh 文件即可；换皮和发型流程不变。

打开编辑器：`./dev.sh editor` 或 `./dev.sh`（同时开游戏）后访问 `http://localhost:5174/`。游戏是 `http://localhost:5173/`，竖屏舞台，发布不含编辑器。
