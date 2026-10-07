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

## 素材

- 角色立绘、战场背景：AI 生成（`public/assets/*.jpg`），可直接替换为同名文件
- 法术图标：[game-icons.net](https://game-icons.net)（CC BY 3.0，作者 Lorc / sbed）

## 结构

- `src/data.ts` 卡牌、英雄、敌人、BOSS、波次生成（调数值改这里）
- `src/scenes/BattleScene.ts` 回合流程、出牌、AI、奖励、前进动画
- `src/ui.ts` 单位与卡牌的绘制
- `src/scenes/BootScene.ts` 资源加载、圆形头像与无缝背景生成
