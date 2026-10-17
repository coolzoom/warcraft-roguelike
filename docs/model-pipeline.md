# AI 3D 模型与动作生成流程

本项目所有 AI 模型（英雄、敌人、首领、路边来客）都按同一条流水线制作：

```
参考图 → TRELLIS 图生 3D（静态网格）→ Blender 绑骨 → 程序化动作烘焙 → 导出 GLB → 接入游戏
```

模型本身由 AI 生成，**骨骼和动作不是 AI 生成的**：骨架按手工读出的关节坐标搭建，动作是 Python 里的数学函数，在 Blender 中烘焙成关键帧。

> 注意：`.playtest/` 整个目录在 `.gitignore` 里，下面提到的脚本、`ai_rig_spec.json`、参考图和原始模型都**不在版本库中**，只存在本机。需要长期保存时请单独备份，或把它们移出忽略目录。

## 文件一览

| 路径 | 作用 |
| --- | --- |
| `.playtest/ai_refs/ref_<art>.jpg` | 参考图 |
| `.playtest/ai_gen.py` | 调用 Hugging Face 上的 TRELLIS，参考图 → 原始 GLB |
| `.playtest/ai_raw/<art>.glb` | TRELLIS 输出的静态网格（无骨骼） |
| `.playtest/ai_rig_common.py` | 导入并归一化原始网格（转朝向、脚踩 z=0、身高 1） |
| `.playtest/ai_rig_preview.py` | 渲染带 0.1 网格的正视图/侧视图，用来读关节坐标 |
| `.playtest/ai_rig_spec.json` | 每个模型的关节坐标和绑骨选项 |
| `.playtest/ai_rig.py` | 建骨架、蒙皮、修正、烘焙动作、导出 |
| `.playtest/ai_pose_preview.py` | 渲染每段动作的关键帧，用来检查 |
| `public/models/ai/<art>.glb` | 最终带骨骼和动画的模型 |
| `public/models/ai/manifest.json` | 游戏加载的模型列表和朝向 |
| `src/three/animator.ts` | 游戏内播放动作 |

`<art>` 是美术编号，例如 `b_sarg`（萨格拉斯）、`p_orc`（兽人）、`n_raven`（乌鸦领主）。

## 1. 参考图

- 用图像生成工具画一张**灰底、全身、正面朝向、双臂略张开**的 Q 版角色图，1024×1024。
- 以已有参考图（如 `ref_b_lich.jpg`）作为风格参考，保持全套风格一致。
- 存到 `.playtest/ai_refs/ref_<art>.jpg`。
- 头像：从参考图裁出头部和上身，`ffmpeg -i ref_<art>.jpg -vf "crop=600:600:212:40,scale=320:320" -q:v 3 public/assets/<art>.jpg`。

经验：**细长的武器（剑、法杖）TRELLIS 经常做丢**，参考图里武器尽量粗、尽量贴近身体；做丢了可以在绑骨时补（见下文 `blade`）。

## 2. 图生 3D（TRELLIS）

```bash
export HTTPS_PROXY=http://127.0.0.1:7897   # 访问 huggingface.co 需要代理时
/tmp/hfenv/bin/python -u .playtest/ai_gen.py .playtest/ai_refs/ref_<art>.jpg:<art>
```

- 调用 Space `trellis-community/TRELLIS`（ZeroGPU），输出 `.playtest/ai_raw/<art>.glb`；已存在的会跳过。
- 使用 `hf auth login` 保存的 token（或 `HF_TOKEN`），登录后 GPU 额度更大。**不要把 token 写进代码或日志。**
- 每个模型约 1 分钟，排队时更久。免费额度每次预留 120 秒 GPU，一天大约 2 到 3 个，用完要等十几个小时恢复。
- 备选：加 `--sf3d` 改用 Stable Fast 3D，速度快但质量较低。

## 3. 定朝向、读关节

```bash
cd .playtest
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P ai_rig_preview.py -- <art>
```

输出 `.playtest/rig/<art>_front.png` 和 `<art>_side.png`（650×650，网格间距 0.1）。

1. **朝向**：正视图看到的应是角色正面。若看到背面，在 spec 里设 `"yaw": 0`（默认 180）。目前所有模型都是 0。
2. **读坐标**：模型已归一化为身高 1、脚底 z=0。按像素换算：
   - 正视图：`x = (px − 325) / 500`，`z = (575 − py) / 500`（角色右手在画面左侧，x 为负）
   - 侧视图：画面向右是 +Y，`y = (px − 325) / 500`；角色面朝 −Y
3. 把关节写进 `ai_rig_spec.json`，坐标是 `[x, z]`，深度 y 自动取该处网格的平均深度；需要时写 `[x, z, y]` 手动指定。

## 4. `ai_rig_spec.json` 字段

必需的人形关节：

```json
"pelvis", "chest", "neck", "top",
"shoulder.L/R", "elbow.L/R", "hand.L/R",
"hip.L/R", "knee.L/R", "foot.L/R"       // 没有腿的模型（拉格纳罗斯）可省略
```

L 是角色的左边（+X）。骨架：`root → pelvis → spine → chest → head`，手臂 `upper_arm → forearm → hand`，腿 `thigh → shin`。

| 字段 | 含义 |
| --- | --- |
| `yaw` | 导入时绕竖直轴旋转的角度，0 或 180 |
| `main` | 主手 `"L"`/`"R"`，攻击时出招的那只手 |
| `style` | 攻击风格：`"melee"` 挥砍、`"cast"` 双手前推、`"bow"` 拉弓 |
| `staff` | 竖直持杖的手，攻击时改成横扫，幅度减小 |
| `robe` | 长袍角色：行走迈腿幅度减半，手臂以下的顶点不跟手臂走（防止袍子被拉扯） |
| `rigid` | `[[骨骼名, [x0,x1,z0,z1(,y0,y1)]], …]`，盒子内顶点 100% 绑到该骨骼。用于武器、法球等硬物 |
| `drop` | `[[x0,x1,z0,z1,y0,y1], …]`，删除盒子内的顶点。用于去掉 TRELLIS 生成的碎片或残缺武器 |
| `bones` | 额外骨骼 `[[名字, 头关节, 尾关节, 父骨骼], …]`，关节名引用 spec 里的自定义点。父骨骼为 `null` 时是不参与动画的固定骨（如拉格纳罗斯、克苏恩的底座） |
| `blade` | 程序生成一把剑：`{bone, from:[x,z], to:[x,z], width, y?, color?}`，带锯齿和护手，整把绑在 `bone` 上 |
| `kind` | 特殊体型，使用单独的动作集：`"dragon"`、`"rag"`、`"cthun"` |

萨格拉斯的完整例子（TRELLIS 只留下了剑柄，于是删掉剑柄、补一把剑）：

```json
"b_sarg": {
  "yaw": 0, "main": "R", "style": "melee",
  "pelvis": [0.0, 0.25], "chest": [0.0, 0.42], "neck": [0.0, 0.55], "top": [0.0, 1.0],
  "shoulder.R": [-0.18, 0.49], "elbow.R": [-0.25, 0.35], "hand.R": [-0.24, 0.27],
  "shoulder.L": [0.17, 0.49], "elbow.L": [0.26, 0.35], "hand.L": [0.25, 0.25],
  "hip.R": [-0.1, 0.21], "knee.R": [-0.14, 0.12], "foot.R": [-0.15, 0.03],
  "hip.L": [0.1, 0.21], "knee.L": [0.14, 0.12], "foot.L": [0.15, 0.03],
  "blade": { "bone": "hand.R", "from": [-0.24, 0.38], "to": [-0.24, 0.95], "width": 0.11, "y": -0.2 },
  "drop": [[-0.3, -0.19, 0.08, 0.24, -0.5, 0.5], [-0.3, -0.15, 0.0, 0.12, 0.08, 0.5], [-0.3, -0.205, 0.0, 0.12, -0.5, 0.5]],
  "robe": true,
  "rigid": [["hand.R", [-0.32, -0.17, 0.22, 0.38]], ["hand.R", [-0.4, -0.12, 0.34, 0.48, -0.45, -0.08]]]
}
```

## 5. 绑骨与蒙皮（`ai_rig.py`）

```bash
cd .playtest
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P ai_rig.py -- <art> [<art> ...]
```

脚本对每个模型依次执行：

1. `load_normalized`：导入原始网格，按 `yaw` 转向，缩放到身高 1，居中，脚踩地面。
2. `drop`：删除 spec 指定的碎片。
3. `build_armature`：按关节坐标建骨架。
4. `skin`：
   - Blender 热量法自动权重；热量法漏掉的顶点（日志里的 `heat-missed`）绑到最近的骨骼；
   - `confine`：Q 版角色头大身短，手臂权重容易渗进躯干和头部，这一步把它们还给身体，抬手时不会拖着身体变形；
   - `rigid`：盒子内的顶点整体绑到指定骨骼。
5. `add_blade`：如有 `blade`，生成剑身。
6. `bake`：烘焙动作（见下节）。
7. 导出 `public/models/ai/<art>.glb`，每段动作是一条 NLA 轨道。

日志示例：

```
DROP b_sarg 339
SKIN b_sarg heat-missed 125 of 14522
BLADE 38 verts at y -0.2
RIGGED b_sarg
```

## 6. 动作是怎么生成的

每段动作是一个 Python 函数 `fn(t, spec)`，输入时间 t（秒），返回三样东西：

- 每根骨骼的旋转 `{骨骼名: (rx, ry, rz)}`（角度，骨架空间欧拉角；角色面朝 −Y，`rx > 0` 让直立的骨骼前倾）
- 根骨骼的位移（跳起、前冲、下沉）
- 根骨骼的旋转（整体摇晃、倒地）

例如待机：躯干随正弦曲线轻轻起伏，头部反向点头，手臂微摆。

```python
def clip_idle(t, sp):
    w = 2 * math.pi * t / 2.0
    b = math.sin(w)
    p = {
        'spine': (1.5 * b, 0, 0), 'chest': (1.5 * b, 0, 0), 'head': (-2.5 * b, 0, 1.5 * math.sin(w * 0.5)),
        'upper_arm.L': (2 * b, out('L', 3 + 2 * b), 0), 'upper_arm.R': (2 * b, out('R', 3 + 2 * b), 0),
        'forearm.L': (-3 * b, 0, 0), 'forearm.R': (-3 * b, 0, 0),
    }
    return p, (0, 0, 0.006 * (1 - math.cos(2 * w)) / 2), (0, 0, 0)
```

一次性动作按阶段写，阶段之间用 `ease`（smoothstep）平滑过渡，`env(k, a, b, c)` 生成"升起—保持—回落"的包络。例如近战攻击：0–30% 蓄力抬臂、30–45% 快速劈下、50–100% 收回，同时转腰、前倾、迈腿、身体前冲。

### 8 段标准动作

| 名称 | 时长 | 内容 |
| --- | --- | --- |
| `idle` | 2.0 s | 呼吸起伏，循环 |
| `walk` | 0.8 s | 摆腿摆臂、上下颠、左右晃，循环 |
| `attack` | 0.8 s | 按 `style`：挥砍 / 双手前推 / 拉弓放箭 |
| `cast` | 1.0 s | 双臂高举再爆发 |
| `hit` | 0.5 s | 后仰、手臂护身 |
| `die` | 1.0 s | 屈膝后向后倒地 |
| `cheer` | 1.0 s | 举手挥舞、小跳 |
| `stun` | 1.2 s | 低头、摇晃 |

### 自动适配

同一套函数会读 spec 自动调整：

- `main` 决定哪只手出招，转腰方向随之镜像；
- 手臂在原模型里就是抬起的（手比肩低不到 0.03），动作幅度缩到 35%，避免手臂扫过脸；
- `staff` 的手幅度缩到 30%；
- `robe` 时行走迈腿减半。

### 特殊动作集（`kind`）

- `dragon`：四足骨架，独立的 8 段动作（扑咬、仰头吐息），翅膀、三节尾巴、前爪都有动画。
- `rag`：沿用人形动作，但 `walk` 改为原地浮动，`die` 改为沉入熔岩。
- `cthun`：六条两节触须，按方向分别弯曲、摆动、抽打。
- 有 `wing.L/R` 骨骼的人形（恐惧魔王）：在标准动作上叠加翅膀扇动（`WING_FLAP` 表定义每段动作的幅度和拍数）。

新增动作集：写一组 `xxx_idle … xxx_stun` 函数，组成 `XXX_CLIPS` 字典，在 `clips_for()` 里按 `kind` 返回即可。

### 烘焙

`bake()` 以 30 fps 对每个动作函数逐帧取样，把欧拉角转成四元数（换算到骨骼自身的静止姿态坐标系），为每根骨骼插入关键帧；每段动作存为一个 Action，并放进同名 NLA 轨道。导出时 `export_animation_mode='NLA_TRACKS'`，GLB 里的动画名就是 `idle`、`attack` 等，游戏按名字取用。

## 7. 检查

```bash
cd .playtest
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P ai_pose_preview.py -- <art>
```

每段动作在 25%、50%、75% 处各渲染一帧（3/4 视角），输出 `.playtest/rig/<art>_<clip>_<i>.png`。拼成 6×4 对照表（每行两段动作；**要用 bash，zsh 会解析错滤镜字符串**）：

```bash
cd .playtest/rig
bash -c 'for a in <art>; do in=""; f=""; n=0; for c in idle walk attack cast hit die cheer stun; do for i in 0 1 2; do in="$in -i ${a}_${c}_${i}.png"; f="${f}[${n}:v]scale=180:180[v${n}];"; n=$((n+1)); done; done; lay=""; maps=""; for k in $(seq 0 23); do x=$(( (k%6)*180 )); y=$(( (k/6)*180 )); lay="${lay}${lay:+|}${x}_${y}"; maps="${maps}[v${k}]"; done; ffmpeg -y -loglevel error $in -filter_complex "${f}${maps}xstack=inputs=24:layout=${lay}" ${a}_sheet.png; done'
```

在对照表里找撕裂、拉伸、穿模。常见问题和修法：

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| 正视图看到背面 | 朝向反了 | `yaw` 改为 0 |
| 挥手时从手上拉出一根细丝/长条到地面 | `rigid` 盒子包住了不该跟手走的部分（底座、残留剑柄） | 缩小盒子；残缺部分用 `drop` 删掉 |
| 抬手时袍子/身体被拉出一大片 | 手臂权重渗入躯干下部 | 加 `"robe": true` |
| 底座跟着身体扭 | 底座没固定 | 加父骨骼为 `null` 的底座骨，用 `rigid` 把底座绑上去 |
| 武器只剩一截柄 | TRELLIS 丢了细长部分 | `drop` 删柄 + `blade` 补剑 |
| 补的剑看不见 | 默认深度取了身体内部的平均值 | 在 `blade` 里手动写 `y`（身体前方为负） |

## 8. 接入游戏

1. 把 `<art>` 加进 `public/models/ai/manifest.json` 的 `arts` 列表，并在 `yaw` 里写 0。
2. 在 `src/data.ts`（以及会整表覆盖它的 `public/card-data.json`）里给角色设置 `art: '<art>'`。
3. 游戏里 `src/three/animator.ts` 用 three.js 的 `AnimationMixer` 播放：`idle`/`walk` 循环，其余为一次性动作，播完淡回待机。一次性动作会按战斗节奏**重新调速**（0.6 到 3 倍），保证"命中"那一帧和伤害数字同时出现。
4. 用 `.playtest/bosses.mjs` 等 puppeteer 测试进游戏截图确认（需先启动 `npx vite --port 5179`）。

## 新模型检查清单

- [ ] 参考图：灰底、全身、正面、武器够粗
- [ ] `ai_gen.py` 生成原始 GLB
- [ ] `ai_rig_preview.py` 确认朝向、读关节，写 spec
- [ ] `ai_rig.py` 绑骨导出，看 `heat-missed` 数量
- [ ] `ai_pose_preview.py` + 拼图，逐帧检查，必要时调 `rigid` / `drop` / `robe` / `blade` 后重跑
- [ ] 加入 `manifest.json`，裁头像
- [ ] 游戏内截图确认
