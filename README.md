# 部落远征 · Horde Expedition

魔兽风格的回合制肉鸽卡牌对战小游戏（Phaser 3 + TypeScript + Vite，竖屏 540×960）。

## 运行

```bash
npm install
npm run dev      # 打开 http://localhost:5173
npm run build    # 产物在 dist/
```

调试：地址后加 `?wave=5` 可直接从指定波次开始（例如直接打 BOSS）。

## 玩法

- 每回合 3 点能量、抽 5 张牌；兵牌召唤英雄（最多 5 个），法术牌立即生效
- 场上已有同名英雄时再打出 → 升星（最高 5 星，属性 +35%/星）
- 点「结束回合」后英雄按技能自动攻击，然后敌人行动；敌人在没有英雄时会直接攻击大本营
- 清空一波后三选一奖励（新卡 / 强化），部落继续前进进入下一波
- 每 5 波一个 BOSS：冰霜骨龙 → 霜冠巫妖 → 恐惧魔王，循环且逐轮变强
- 大本营生命归零即失败，记录最远波次

### 天赋（主菜单「⭐ 天赋」）

- 每局结束获得天赋点：每清一波 +1，每击杀一个 BOSS 再 +2；天赋永久保留，可随时免费重置
- 四条分支：大本营（生命上限 / 每波回血 / 反伤）、能量（开局爆发 / +1 能量上限 / +1 手牌）、法术（法术强度 / 首个法术后抽牌）、兵种（逐个强化 6 个英雄，以及“召唤即 2 星”）
- 例：兽人血统 + 城墙反伤 = 前排硬抗流；能量之泉 + 法术回响 + 秘法研习 = 法术流

### 卡组编辑（主菜单「🃏 卡组」）

- 自由组合起始卡组：10–16 张、至少 1 张英雄；同名上限 普通 3 / 稀有 2 / 史诗 1
- 点卡牌看效果，＋/－ 调整，「保存」后下次远征生效，「出征」直接开打

## 素材

- 角色立绘、战场背景：AI 生成（`public/assets/*.jpg`），可直接替换为同名文件
- 法术图标：[game-icons.net](https://game-icons.net)（CC BY 3.0，作者 Lorc / sbed）
- 3D 角色（`public/models/`，带骨骼动画，运行时按阵营重新配色/装备）：
  - [KayKit Adventurers / Skeletons](https://kaylousberg.itch.io)（CC0，作者 Kay Lousberg）
  - [Quaternius](https://quaternius.com) 怪物模型，经 [Poly Pizza](https://poly.pizza) 获取（CC0）
- AI 3D 角色（`public/models/ai/`，主菜单「⚙ 设置」切换）：由立绘 AI 生成全身参考图，再用 [TRELLIS](https://huggingface.co/spaces/trellis-community/TRELLIS) 转成 3D；已生成的单位列在 `manifest.json`，其余沿用现有模型

## 结构

- `src/data.ts` 卡牌、英雄、敌人、BOSS、波次生成（调数值改这里）
- `src/scenes/BattleScene.ts` 回合流程、出牌、AI、奖励、前进动画
- `src/meta.ts` 天赋表、天赋点、卡组规则与存档（`localStorage.horde_profile`）
- `src/scenes/TalentScene.ts` / `DeckScene.ts` 天赋树与卡组编辑界面
- `src/three/battlefield.ts` three.js 3D 战场背景（道路、树木、营火、旗帜、雾；BOSS 波切换暗紫色调）
- `src/ui.ts` 单位与卡牌的绘制
- `src/scenes/BootScene.ts` 资源加载、圆形头像与无缝背景生成
