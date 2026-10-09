import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { BattleScene } from './scenes/BattleScene';
import { TalentScene } from './scenes/TalentScene';
import { DeckScene } from './scenes/DeckScene';
import { getStage } from './three/stage';
import { getBattlefield } from './three/battlefield';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 540,
  height: 960,
  backgroundColor: '#1a120c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, BattleScene, TalentScene, DeckScene],
});

// 3D models are optional: if WebGL is unavailable the round portraits are used instead.
game.events.once(Phaser.Core.Events.READY, () => {
  try {
    getStage().attach(game);
  } catch (err) {
    console.warn('3D models disabled:', err);
  }
  try {
    getBattlefield().attach(game);
  } catch (err) {
    console.warn('3D battlefield disabled:', err);
  }
});

if (import.meta.env.DEV) (window as unknown as { stage: unknown }).stage = getStage;
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
